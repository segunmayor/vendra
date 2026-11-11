'use client';

import { createContext, type FormEvent, type ReactNode, startTransition, useActionState, useContext, useEffect, useRef } from 'react';
import { useFormStatus } from 'react-dom';
import { Button, type ButtonProps } from './button';
import { Alert } from './fields';

export interface FormState {
  readonly status: 'idle' | 'success' | 'error';
  readonly message?: string;
}

export const idleForm: FormState = { status: 'idle' };

const PendingContext = createContext(false);

/**
 * A form bound to a Server Action, showing its outcome. Without JavaScript it posts
 * normally. With JavaScript it keeps what was typed when the action fails (React would
 * otherwise clear the form) and resets only after a success.
 */
export function ActionForm({
  action,
  children,
  className,
}: {
  action: (state: FormState, data: FormData) => Promise<FormState>;
  children: ReactNode;
  className?: string;
}) {
  const [state, formAction, pending] = useActionState(action, idleForm);
  const form = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.status === 'success') form.current?.reset();
  }, [state]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    const data = new FormData(event.currentTarget, (event.nativeEvent as SubmitEvent).submitter);
    startTransition(() => formAction(data));
  };

  return (
    <form ref={form} action={formAction} onSubmit={submit} aria-busy={pending}>
      {/* The message sits outside the layout container, so grid and flex forms do not squeeze it into a column. */}
      {state.status === 'error' && state.message ? <div className="mb-3"><Alert>{state.message}</Alert></div> : null}
      {state.status === 'success' && state.message ? <div className="mb-3"><Alert tone="success">{state.message}</Alert></div> : null}
      <PendingContext.Provider value={pending}>
        <div className={className}>{children}</div>
      </PendingContext.Provider>
    </form>
  );
}

/** Disabled while its form is submitting, so a double click cannot send twice. */
export function SubmitButton({ children, pendingLabel, ...props }: ButtonProps & { pendingLabel?: string }) {
  const actionPending = useContext(PendingContext);
  const { pending: nativePending } = useFormStatus();
  const pending = actionPending || nativePending;
  return (
    <Button type="submit" disabled={pending || props.disabled} aria-disabled={pending} {...props}>
      {pending ? (pendingLabel ?? 'Saving…') : children}
    </Button>
  );
}
