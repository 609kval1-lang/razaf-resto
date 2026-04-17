import { useCallback, useEffect, useRef } from 'react';

const useSerializedAsyncCallback = (callback) => {
  const callbackRef = useRef(callback);
  const inFlightRef = useRef(false);
  const queuedArgsRef = useRef(undefined);
  const queuedDeferredRef = useRef(null);

  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  const runNow = useCallback((args) => {
    inFlightRef.current = true;

    const promise = Promise.resolve().then(() => callbackRef.current(args));

    const handleSettled = () => {
      inFlightRef.current = false;

      if (!queuedDeferredRef.current) {
        return;
      }

      const nextArgs = queuedArgsRef.current;
      const deferred = queuedDeferredRef.current;

      queuedArgsRef.current = undefined;
      queuedDeferredRef.current = null;

      runNow(nextArgs).then(deferred.resolve).catch(deferred.reject);
    };

    promise.then(handleSettled, handleSettled);

    return promise;
  }, []);

  return useCallback((args) => {
    if (!inFlightRef.current) {
      return runNow(args);
    }

    queuedArgsRef.current = args;

    if (!queuedDeferredRef.current) {
      let resolve;
      let reject;

      const promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
      });

      queuedDeferredRef.current = { promise, resolve, reject };
    }

    return queuedDeferredRef.current.promise;
  }, [runNow]);
};

export default useSerializedAsyncCallback;
