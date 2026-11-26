import { useEffect } from 'react'

export function useHotkeys(key: string, callback: (event: KeyboardEvent) => void) {
  useEffect(() => {
    const listener = (event: KeyboardEvent) => { if (event.key.toLowerCase() === key.toLowerCase()) callback(event) }
    window.addEventListener('keydown', listener)
    return () => window.removeEventListener('keydown', listener)
  }, [key, callback])
}
