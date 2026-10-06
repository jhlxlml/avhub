import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

export type SeekRoute = 'original' | 'segments' | 'restart';
type SeekMeasurement = { route: SeekRoute; target: number; elapsedMs: number | null };

export function usePlaybackDiagnostics(video: RefObject<HTMLVideoElement | null>, offset: RefObject<number>, autoStart: boolean) {
  const [firstFrameMs, setFirstFrameMs] = useState<number | null>(null);
  const [lastSeek, setLastSeek] = useState<SeekMeasurement | null>(null);
  const [decodedSize, setDecodedSize] = useState({ width: 0, height: 0 });
  const startup = useRef<number | null>(autoStart ? performance.now() : null);
  const pendingSeek = useRef<{ target: number; started: number; route: SeekRoute } | null>(null);
  const frameCallback = useRef<number | null>(null);

  const cancelObservation = useCallback(() => {
    if (frameCallback.current !== null) video.current?.cancelVideoFrameCallback?.(frameCallback.current);
    frameCallback.current = null;
  }, [video]);

  const observeFrame = useCallback(() => {
    const element = video.current;
    if (!element || frameCallback.current !== null) return;
    const capture = (mediaTime: number, presented = false) => {
      // A frame callback is evidence of presentation even when the media
      // element has not yet cleared its transient seeking/readyState flags.
      // Rejecting that paused frame could wait forever for a second callback.
      if (!presented && (element.seeking || element.readyState < 2)) return false;
      setDecodedSize(previous => previous.width === element.videoWidth && previous.height === element.videoHeight
        ? previous : { width: element.videoWidth, height: element.videoHeight });
      const seek = pendingSeek.current;
      // A queued pre-seek frame must not count as the target frame.
      if (seek && Math.abs(mediaTime + offset.current - seek.target) > 1.5) return false;
      const now = performance.now();
      if (startup.current !== null) {
        setFirstFrameMs(Math.round(now - startup.current));
        startup.current = null;
      }
      if (seek) {
        setLastSeek({ route: seek.route, target: seek.target, elapsedMs: Math.round(now - seek.started) });
        pendingSeek.current = null;
      }
      return true;
    };
    if (typeof element.requestVideoFrameCallback !== 'function') {
      capture(element.currentTime);
      return;
    }
    if (startup.current === null && pendingSeek.current === null) {
      capture(element.currentTime);
      return;
    }
    const presented: VideoFrameRequestCallback = (_, metadata) => {
      frameCallback.current = null;
      if (!capture(metadata.mediaTime, true) && (startup.current !== null || pendingSeek.current !== null)) {
        frameCallback.current = element.requestVideoFrameCallback(presented);
      }
    };
    frameCallback.current = element.requestVideoFrameCallback(presented);
  }, [video, offset]);

  useEffect(() => {
    const element = video.current;
    if (!element) return;
    for (const event of ['loadeddata', 'playing', 'seeked']) element.addEventListener(event, observeFrame);
    return () => {
      for (const event of ['loadeddata', 'playing', 'seeked']) element.removeEventListener(event, observeFrame);
      cancelObservation();
    };
  }, [video, observeFrame, cancelObservation]);

  function beginStartup() {
    cancelObservation();
    startup.current = performance.now();
    pendingSeek.current = null;
    setFirstFrameMs(null);
    setLastSeek(null);
  }
  function beginSeek(target: number, route: SeekRoute) {
    cancelObservation();
    pendingSeek.current = { target, route, started: performance.now() };
    setLastSeek({ route, target, elapsedMs: null });
    // Register before changing currentTime, including when paused: seeked may
    // arrive after the browser has already presented its only new frame.
    if (route !== 'restart') observeFrame();
  }
  function sourceChanged() {
    cancelObservation();
    setDecodedSize({ width: 0, height: 0 });
  }
  function abortTiming() {
    cancelObservation();
    startup.current = null;
    if (pendingSeek.current) setLastSeek(null);
    pendingSeek.current = null;
  }
  return { firstFrameMs, lastSeek, decodedSize, beginStartup, beginSeek, sourceChanged, observeFrame, cancelObservation, abortTiming };
}
