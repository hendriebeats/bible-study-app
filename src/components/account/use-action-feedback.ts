import { type RefObject, useEffect } from "react";
import { toast } from "sonner";

import type { ActionState } from "@/app/account/actions";

/**
 * Toasts when an account action resolves, and (optionally) resets the form on
 * success so stale values don't linger.
 */
export function useActionFeedback(
  state: ActionState,
  formRef?: RefObject<HTMLFormElement | null>,
) {
  useEffect(() => {
    if (!state) {
      return;
    }
    if (state.status === "success") {
      toast.success(state.message);
      formRef?.current?.reset();
    } else {
      toast.error(state.message);
    }
  }, [state, formRef]);
}
