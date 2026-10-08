import type {ContextMenuParams,MenuItemConstructorOptions} from 'electron';
type Context=Pick<ContextMenuParams,'isEditable'|'formControlType'|'editFlags'>;
const fields=new Set(['none','input-text','input-search','input-email','input-telephone','input-url','input-number','text-area']);
// Fixed native edit roles only. No clipboard polling, file commands or renderer
// supplied labels/URLs. Chromium determines selection and edit availability.
export function textEditTemplate(context:Context):MenuItemConstructorOptions[] {
  if(!context.isEditable||!fields.has(context.formControlType))return [];
  const flags=context.editFlags;
  return [
    {label:'撤销',role:'undo',enabled:flags.canUndo},
    {label:'重做',role:'redo',enabled:flags.canRedo},
    {type:'separator'},
    {label:'剪切',role:'cut',enabled:flags.canCut},
    {label:'复制',role:'copy',enabled:flags.canCopy},
    {label:'粘贴',role:'paste',enabled:flags.canPaste},
    {type:'separator'},
    {label:'全选',role:'selectAll',enabled:flags.canSelectAll},
  ];
}
