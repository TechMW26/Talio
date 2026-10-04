// Webpack retains rejected chunk imports. A React boundary reset alone cannot
// recover them; reload only when the user explicitly chooses Try Again.
export function retryPageError(error, reset, reload = () => window.location.reload()) {
  if (error?.name === 'ChunkLoadError'
    || /Loading (?:CSS )?chunk .+ failed|Failed to fetch dynamically imported module/i.test(error?.message || '')) {
    reload()
    return
  }
  reset()
}
