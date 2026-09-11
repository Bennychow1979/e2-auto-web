'use strict';
(() => {
  const get = id => document.getElementById(id);
  const deposit = get('deposit'), rate = get('rate');
  const fmt = n => 'RM' + Math.round(n).toLocaleString('en-MY');
  const identity = '2017 Honda CR-V TC-P 2WD 1.5 Auto, plate JMK882, RM61,990. Reported mileage: 750,000 km (pending confirmation).';
  const link = text => 'https://wa.me/60122785126?text=' + encodeURIComponent(text);
  const requests = {
    photos: 'Please send the latest real exterior, cabin, boot, engine bay and odometer photos.',
    trade: 'I would like to discuss a trade-in. My current car (make/model/year/mileage/condition): ',
    loan: 'Please help me check loan eligibility and the information needed to apply.',
    viewing: 'I would like to book a viewing. Please confirm availability, the showroom address and a suitable time, and verify the mileage.'
  };
  document.querySelectorAll('[data-enquiry]').forEach(a => {
    a.href = link('Hi E2 Auto, I am interested in ' + identity + ' ' + requests[a.dataset.enquiry]);
  });
  document.querySelectorAll('.stickyBar a').forEach(a => {
    if (a.textContent.includes('Book viewing')) a.href = link('Hi E2 Auto, ' + identity + ' ' + requests.viewing);
  });
  let years = 5;
  function calc() {
    const dep = Math.max(0, Math.min(61990, Number(deposit.value) || 0));
    const annualRate = Number(rate.value) || 0;
    const loan = 61990 - dep;
    const interest = loan * annualRate / 100 * years;
    const total = loan + interest;
    const monthly = total / (years * 12);
    get('depositOut').textContent = fmt(dep);
    get('rateOut').textContent = annualRate.toFixed(2) + '%';
    get('termOut').textContent = years + ' years';
    get('monthly').textContent = fmt(monthly);
    get('meta').textContent = 'Loan ' + fmt(loan) + ' · ' + years + ' years · ' + annualRate.toFixed(2) + '% flat rate. Total interest ' + fmt(interest) + '; total loan repayment ' + fmt(total) + '.';
    get('wa').href = link('Hi E2 Auto, I am interested in ' + identity + ' My illustrative estimate: deposit ' + fmt(dep) + ', loan ' + fmt(loan) + ', ' + years + ' years, ' + annualRate.toFixed(2) + '% annual flat rate, about ' + fmt(monthly) + '/month. Excludes fees; subject to lender assessment, not guaranteed approval. Please confirm the mileage and available financing.');
    document.querySelectorAll('[data-y]').forEach(b => {
      const selected = Number(b.dataset.y) === years;
      b.classList.toggle('active', selected);
      b.setAttribute('aria-pressed', String(selected));
    });
  }
  [deposit, rate].forEach(input => input.addEventListener('input', calc));
  document.querySelectorAll('[data-y]').forEach(button => button.addEventListener('click', () => {
    years = Number(button.dataset.y);
    calc();
  }));
  calc();
})();

