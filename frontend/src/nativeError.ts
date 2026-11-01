import {PlaybackSessionFailure} from './playback/PlaybackSessionCoordinator';
export function nativeErrorText(error:unknown){
  const message=(error instanceof Error?error.message:'操作失败，请重试').replace(/^Error invoking remote method ['"]avhub:(?:native-player|render-player)['"]:\s*(?:Error:\s*)?/,'');
  return error instanceof PlaybackSessionFailure?`${message}。${error.recoveryHint}`:message;
}
