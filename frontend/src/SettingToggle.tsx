import {useId,type ReactNode} from 'react';

// Native checkbox semantics and keyboard behavior, shared across settings.
// No preference writes or optimistic state belong in this display primitive.
export function SettingToggle({label,children,description,checked,disabled,onChange}:{
  label:string;children?:ReactNode;description?:string;checked:boolean;disabled?:boolean;onChange:(checked:boolean)=>void;
}) {
  const id=useId();
  return <label className="settings-toggle-row">
    <span className="settings-toggle-copy"><b>{children||label}</b>{description&&<small id={id}>{description}</small>}</span>
    <input className="settings-switch" type="checkbox" aria-label={label} aria-describedby={description?id:undefined}
      checked={checked} disabled={disabled} onChange={event=>onChange(event.target.checked)}/>
  </label>;
}
