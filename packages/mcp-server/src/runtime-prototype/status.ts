import type { Registration } from './protocol'

import { VersionSchema } from '../runtime-update/manifest'
import { newerVersion } from './state'

/** Project version evidence only; registrations also contain private host context and capabilities. */
export function controlComponentStatus(
  supervisorVersion: string,
  registrations: Registration[],
  availableVersions: string[]
) {
  const latest = availableVersions.reduce(
    (latest, version) => (newerVersion(version, latest) ? version : latest),
    supervisorVersion
  )
  const component = (value?: string) => {
    const version = VersionSchema.safeParse(value).data ?? null
    const pendingVersion = version && newerVersion(latest, version) ? latest : null
    return { version, pendingVersion, restartRequired: version ? pendingVersion !== null : null }
  }
  const supervisor = component(supervisorVersion)
  const edges = registrations.map((registration) => component(registration.updates?.version))
  const components = [supervisor, ...edges]
  return {
    supervisor,
    edges,
    restartRequired: components.some((value) => value.restartRequired === true)
      ? true
      : components.some((value) => value.restartRequired === null)
        ? null
        : false
  }
}
