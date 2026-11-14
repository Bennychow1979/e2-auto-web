"""Public, strictly allowlisted metadata. Never import backup contents here."""
import base64
import datetime as dt
import json
import os
from pathlib import Path
import sys
import urllib.error
import urllib.request

UTC = dt.timezone.utc
MYT = dt.timezone(dt.timedelta(hours=8))
REPOSITORY = 'Bennychow1979/e2-auto-web'
BRANCH = 'backup-status'
STATUS_PATH = 'status.json'
PUBLIC_URL = f'https://raw.githubusercontent.com/{REPOSITORY}/{BRANCH}/{STATUS_PATH}'
FIELDS = {'updated_at', 'db_last_ok', 'db_bytes', 'files_last_ok', 'files_bytes', 'ok'}


def timestamp(now=None):
    return (now or dt.datetime.now(UTC)).astimezone(UTC).isoformat(timespec='seconds').replace('+00:00', 'Z')


def parse_time(value):
    if not isinstance(value, str) or not value.endswith('Z'):
        raise ValueError('Invalid status timestamp')
    return dt.datetime.fromisoformat(value[:-1] + '+00:00')


def empty_status():
    return dict(updated_at=None, db_last_ok=None, db_bytes=0, files_last_ok=None, files_bytes=0, ok=False)


def validate_status(value):
    if not isinstance(value, dict) or set(value) != FIELDS or type(value['ok']) is not bool:
        raise ValueError('Invalid public status schema')
    for field in ('updated_at', 'db_last_ok', 'files_last_ok'):
        if value[field] is not None:
            parse_time(value[field])
    for field in ('db_bytes', 'files_bytes'):
        if type(value[field]) is not int or value[field] < 0:
            raise ValueError('Invalid public byte count')
    return value


def fresh(value, days, now):
    return value is not None and dt.timedelta(0) <= now - parse_time(value) < dt.timedelta(days=days)


def files_due(previous, now, force=False):
    last = previous['files_last_ok']
    if force or not fresh(last, 7, now):
        return True
    local = now.astimezone(MYT)
    latest_sunday = local.date() - dt.timedelta(days=(local.weekday() + 1) % 7)
    return parse_time(last).astimezone(MYT).date() < latest_sunday


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def github(path, method='GET', body=None):
    token = os.environ['GITHUB_TOKEN']
    req = urllib.request.Request(
        f'https://api.github.com/repos/{REPOSITORY}/{path}',
        data=None if body is None else json.dumps(body).encode(), method=method,
        headers={'Authorization': f'Bearer {token}', 'Accept': 'application/vnd.github+json',
                 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json'})
    with urllib.request.build_opener(NoRedirect).open(req, timeout=45) as response:
        return json.load(response)


def read_remote():
    # The branch/file is provisioned at deployment. A missing/corrupt state is an
    # error, never silently reset: otherwise last-known successful times are lost.
    result = github(f'contents/{STATUS_PATH}?ref={BRANCH}')
    value = json.loads(base64.b64decode(result['content']))
    return validate_status(value), result['sha']


def result_path():
    return Path(os.environ['RUNNER_TEMP']) / 'e2-backup-result.json'


def combine(previous, result, succeeded, now):
    state = dict(validate_status(previous))
    for prefix in ('db', 'files'):
        item = result.get(prefix)
        if item is not None:
            if set(item) != {'last_ok', 'bytes'} or type(item['bytes']) is not int or item['bytes'] <= 0:
                raise ValueError('Invalid backup receipt')
            parse_time(item['last_ok'])
            state[prefix + '_last_ok'] = item['last_ok']
            state[prefix + '_bytes'] = item['bytes']
    state['updated_at'] = timestamp(now)
    state['ok'] = bool(succeeded and result.get('complete') is True
                       and fresh(state['db_last_ok'], 2, now)
                       and fresh(state['files_last_ok'], 8, now))
    return validate_status(state)


def publish():
    previous, sha = read_remote()
    receipt = json.loads(result_path().read_text()) if result_path().exists() else {}
    state = combine(previous, receipt, os.environ.get('BACKUP_JOB_STATUS') == 'success', dt.datetime.now(UTC))
    content = base64.b64encode((json.dumps(state, separators=(',', ':')) + '\n').encode()).decode()
    github(f'contents/{STATUS_PATH}', 'PUT', {
        'message': 'Update backup timestamps and encrypted sizes',
        'branch': BRANCH, 'sha': sha, 'content': content})
    print('Public backup metadata updated.')


if __name__ == '__main__':
    try:
        publish()
    except Exception:
        print('Backup status publication failed; check GitHub write access and backup-status branch.', file=sys.stderr)
        sys.exit(1)
