/**
 * Canonical attendance-device catalogue.
 *
 * Device vendors frequently rebrand the same firmware and introduce new model
 * numbers. Talio therefore stores a stable provider key plus a free-form model,
 * while this registry gives administrators searchable, well-known model
 * families and the connection modes that the vendor publicly supports.
 */
export const ATTENDANCE_MACHINE_CONNECTION_MODES = {
  push_http: {
    label: 'Device push / webhook',
    description: 'The machine or vendor cloud sends punches to Talio over HTTPS.',
    vercelCompatible: true,
  },
  cloud_api: {
    label: 'Vendor cloud API',
    description: 'Talio synchronises punches from the vendor cloud over HTTPS.',
    vercelCompatible: true,
  },
  lan_bridge: {
    label: 'Talio LAN bridge',
    description: 'A lightweight outbound bridge connects a private-office machine to Talio.',
    vercelCompatible: true,
    requiresBridge: true,
  },
  file_import: {
    label: 'Scheduled file import',
    description: 'Import vendor CSV or attendance exports when no live API is available.',
    vercelCompatible: true,
  },
}

export const ATTENDANCE_MACHINE_PROVIDERS = [
  {
    key: 'zkteco',
    name: 'ZKTeco',
    modes: ['push_http', 'cloud_api', 'lan_bridge'],
    models: ['K40', 'K50', 'K60', 'K90', 'iClock series', 'SpeedFace series', 'ProFace X', 'MB series', 'uFace series', 'SilkBio series', 'WL series'],
    keywords: ['zkteco', 'zk', 'adms', 'wdms', 'push sdk', 'biotime'],
  },
  {
    key: 'essl',
    name: 'eSSL',
    modes: ['push_http', 'cloud_api', 'lan_bridge'],
    models: ['K30 Pro', 'K90 Pro', 'X990', 'MB160', 'AiFace series', 'iClock series', 'SilkBio series', 'UFace series'],
    keywords: ['essl', 'etimetracklite', 'adms', 'wdms', 'identix'],
  },
  {
    key: 'hikvision',
    name: 'Hikvision',
    modes: ['push_http', 'cloud_api', 'lan_bridge'],
    models: ['MinMoe DS-K1T series', 'DS-K1A series', 'DS-K1T face terminals', 'Access control terminals'],
    keywords: ['hikvision', 'isapi', 'minmoe', 'hikcentral'],
  },
  {
    key: 'suprema',
    name: 'Suprema',
    modes: ['cloud_api', 'lan_bridge'],
    models: ['BioStation 2', 'BioStation 2a', 'BioStation 3', 'FaceStation F2', 'FaceStation 2', 'BioLite N2', 'X-Station 2'],
    keywords: ['suprema', 'biostar', 'g-sdk', 'device sdk'],
  },
  {
    key: 'matrix_cosec',
    name: 'Matrix COSEC',
    modes: ['push_http', 'cloud_api', 'lan_bridge'],
    models: ['COSEC ARGO FACE series', 'COSEC ARGO series', 'COSEC VEGA series', 'COSEC PATH series', 'COSEC ARC series', 'COSEC INTEGRA series'],
    keywords: ['matrix', 'cosec', 'dapi', 'papi', 'fapi', 'vyom', 'centra'],
  },
  {
    key: 'anviz',
    name: 'Anviz',
    modes: ['cloud_api', 'lan_bridge'],
    models: ['CrossChex Cloud', 'W1 Pro', 'W2 Pro', 'C2 Pro', 'EP300 Pro', 'FaceDeep series', 'M7 Palm'],
    keywords: ['anviz', 'crosschex', 'device sdk', 'local web api'],
  },
  {
    key: 'dahua',
    name: 'Dahua',
    modes: ['cloud_api', 'lan_bridge'],
    models: ['ASI3 series', 'ASI6 series', 'ASI7 series', 'DHI-ASA series', 'DSS access terminals'],
    keywords: ['dahua', 'dss', 'netsdk', 'access control'],
  },
  {
    key: 'mantra',
    name: 'Mantra Softech',
    modes: ['push_http', 'cloud_api', 'lan_bridge'],
    models: ['BioFace series', 'MFS attendance series', 'Palm/face attendance terminals', 'Integrated biometric terminals'],
    keywords: ['mantra', 'mantratec', 'mfs', 'bioface', 'rest api'],
  },
  {
    key: 'realtime',
    name: 'Realtime Biometrics',
    modes: ['cloud_api', 'lan_bridge', 'file_import'],
    models: ['RS 70', 'T series', 'Face series', 'Palm series', 'Realtime attendance terminals'],
    keywords: ['realtime', 'biometrics', 'rs70', 'cloud attendance'],
  },
  {
    key: 'spectra',
    name: 'Spectra',
    modes: ['cloud_api', 'lan_bridge', 'file_import'],
    models: ['BioScribe series', 'QuadXs series', 'Spectra attendance terminals'],
    keywords: ['spectra', 'biometric', 'access control', 'api'],
  },
  {
    key: 'cp_plus',
    name: 'CP PLUS',
    modes: ['push_http', 'lan_bridge', 'file_import'],
    models: ['CP-MTA-F1043', 'CP-MTA-F3043', 'CP-VTA-T2124-C', 'CP-VTA-T2124-CR', 'CP-VTA-T2324-U', 'CPTAMs compatible devices'],
    keywords: ['cp plus', 'cptams', 'mta', 'vta', 'push data'],
  },
  {
    key: 'honeywell',
    name: 'Honeywell',
    modes: ['cloud_api', 'lan_bridge'],
    models: ['Pro-Watch compatible terminals', 'Honeywell access control readers', 'Face recognition terminals'],
    keywords: ['honeywell', 'pro-watch', 'access control'],
  },
  {
    key: 'secureye',
    name: 'Secureye',
    modes: ['push_http', 'lan_bridge', 'file_import'],
    models: ['S-B series', 'S-FB series', 'Face attendance series', 'Secureye biometric terminals'],
    keywords: ['secureye', 'biometric', 'face attendance'],
  },
  {
    key: 'bioenable',
    name: 'BioEnable',
    modes: ['cloud_api', 'lan_bridge'],
    models: ['eNBioAccess series', 'Face attendance series', 'Fingerprint attendance terminals'],
    keywords: ['bioenable', 'enbioaccess', 'biometric sdk'],
  },
  {
    key: 'nitgen',
    name: 'NITGEN',
    modes: ['lan_bridge', 'file_import'],
    models: ['eNBioAccess-T1', 'eNBioAccess-T5', 'NAC series', 'Fingkey series'],
    keywords: ['nitgen', 'enbioaccess', 'fingkey'],
  },
  {
    key: 'startek',
    name: 'Startek',
    modes: ['lan_bridge', 'file_import'],
    models: ['FM220 integrated systems', 'Startek fingerprint terminals', 'OEM biometric systems'],
    keywords: ['startek', 'fm220', 'fingerprint'],
  },
  {
    key: 'custom',
    name: 'Other / Custom device',
    modes: ['push_http', 'cloud_api', 'lan_bridge', 'file_import'],
    models: ['Generic HTTP webhook', 'Generic REST API', 'Generic LAN/SDK bridge', 'CSV/SFTP export'],
    keywords: ['custom', 'other', 'generic', 'oem', 'white label'],
  },
]

const PROVIDER_BY_KEY = Object.fromEntries(ATTENDANCE_MACHINE_PROVIDERS.map((provider) => [provider.key, provider]))

export function getAttendanceMachineProvider(providerKey) {
  return PROVIDER_BY_KEY[String(providerKey || '').trim().toLowerCase()] || null
}

export function isSupportedConnectionMode(providerKey, connectionMode) {
  const provider = getAttendanceMachineProvider(providerKey)
  return Boolean(provider?.modes.includes(connectionMode))
}

export function searchAttendanceMachineProviders(query = '') {
  const normalized = String(query).trim().toLowerCase()
  if (!normalized) return ATTENDANCE_MACHINE_PROVIDERS

  return ATTENDANCE_MACHINE_PROVIDERS.filter((provider) => [
    provider.name,
    provider.key,
    ...provider.models,
    ...provider.keywords,
  ].some((value) => String(value).toLowerCase().includes(normalized)))
}

