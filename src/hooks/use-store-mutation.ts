import { useCallback, useRef, useState } from "react";
import { pushDiagnosticError } from "@/lib/errorHandling";

type MutationOptions<TResult> = {
  onSuccess?: (data: TResult) => void;
  onError?: (error: unknown) => void;
};

/**
 * Small mutation helper for store actions. Works with sync AND async actions (the attendance engine
 * runs in a worker), exposes a real `isPending`, and never swallows errors silently: without an
 * `onError` the error is reported through the global diagnostics toast.
 */
export function useStoreMutation<TInput, TResult>(action: (input: TInput) => TResult | Promise<TResult>) {
  const [isPending, setIsPending] = useState(false);
  const actionRef = useRef(action);
  actionRef.current = action;

  const mutateAsync = useCallback(async (input: TInput): Promise<TResult> => {
    setIsPending(true);
    try {
      return await actionRef.current(input);
    } finally {
      setIsPending(false);
    }
  }, []);

  const mutate = useCallback(
    (input: TInput, options?: MutationOptions<TResult>) => {
      mutateAsync(input).then(
        (result) => options?.onSuccess?.(result),
        (error) => {
          if (options?.onError) options.onError(error);
          else pushDiagnosticError(error, "mutation");
        }
      );
    },
    [mutateAsync]
  );

  return { mutate, mutateAsync, isPending };
}
