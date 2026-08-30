import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import receiptsRemote from 'dsh-legion-receipts/remote'

/** The Gateway-owned Client Remote service must exist before self-mount. */
export const inject = ['remote']

/** Mount this package's generated Remote contribution for the current Client fiber. */
export async function apply(ctx: Context): Promise<() => Promise<void>> {
  return await ctx.remote.$mount(receiptsRemote)
}
