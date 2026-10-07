// Keep native confirmation and explicit consequences for destructive actions.
export function confirmAction(title:string,details:string,consequence:string){
  return window.confirm(`${title}\n\n${details}\n\n${consequence}`);
}
