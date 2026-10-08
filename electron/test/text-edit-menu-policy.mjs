import assert from 'node:assert/strict';
import {textEditTemplate} from '../dist/textEditMenu.js';
const flags={canUndo:false,canRedo:false,canCut:false,canCopy:false,canPaste:true,canDelete:false,canSelectAll:true,canEditRichly:false};
for(const type of ['input-search','input-text','text-area','none']) {
  const items=textEditTemplate({isEditable:true,formControlType:type,editFlags:flags});
  assert.deepEqual(items.filter(i=>i.role).map(i=>i.role),['undo','redo','cut','copy','paste','selectAll']);
  assert.equal(items.find(i=>i.role==='copy').enabled,false);assert.equal(items.find(i=>i.role==='paste').enabled,true);
}
for(const type of ['input-range','input-password','input-file','input-checkbox','select-one'])assert.deepEqual(textEditTemplate({isEditable:true,formControlType:type,editFlags:flags}),[]);
assert.deepEqual(textEditTemplate({isEditable:false,formControlType:'input-text',editFlags:flags}),[]);
console.log('Text edit menu policy passed: fixed roles, editable fields only and edit-state availability.');
