import type { Context, Service } from '@deepseek-ai/cordis'

/** Public protocol declarations mirrored only so package-mode can attribute symbols. */
export abstract class TypertRemoteService<out T = never> extends Service<T> {
  protected constructor(ctx: Context, serviceKey: string, options?: { readonly namespace?: string })
}

export function Remote(options: { readonly mode: 'stream' }): <
  This extends object,
  Args extends unknown[],
  Result,
>(
  method: (this: This, ...args: Args) => Result,
  context: ClassMethodDecoratorContext<This, (this: This, ...args: Args) => Result>,
) => void
