import { useMemo } from 'react'

import { useAuthStore } from '../store/authStore'

export function useCapability(capabilityCode: string) {
  const user = useAuthStore((state) => state.user)

  return useMemo(() => {
    if (!user) {
      return false
    }

    return user.capabilities.includes(capabilityCode)
  }, [capabilityCode, user])
}
