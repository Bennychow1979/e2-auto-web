// An auth event can establish the initial identity before INITIAL_SESSION.
// Every accepted hydration is bound to that identity, including reads already
// pending when the first event arrives. No tokens or profile fields are retained.
export function createSessionIdentity(){
 let identity;
 const id=user=>user?.id||null;
 return {
  observe(session){const next=id(session?.user),changed=identity!==undefined&&next!==identity;identity=next;return changed;},
  accepts(user){const next=id(user);if(identity===undefined)identity=next;return identity===next;}
 };
}
