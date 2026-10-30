// Browser-side test driver: accessible names survive icon-only pagination.
export function advanceLibraryPage(forward){
 const page=Number(new URL(location.href).searchParams.get('page'))||1;
 const pages=Number(document.querySelector('[aria-label="跳转页码"]')?.max)||1;
 if(page>=pages)forward=false;else if(page<=1)forward=true;
 const button=document.querySelector(`.pagination button[aria-label="${forward?'下一页':'上一页'}"]`);
 if(!button||button.disabled)return null;
 button.click();return {forward,page:page+(forward?1:-1)};
}
