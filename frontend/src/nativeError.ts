import {errorText} from './api';
export function nativeErrorText(error:unknown){
  return errorText(error).replace(/^Error invoking remote method ['"]avhub:(?:native-player|render-player)['"]:\s*(?:Error:\s*)?/,'');
}
