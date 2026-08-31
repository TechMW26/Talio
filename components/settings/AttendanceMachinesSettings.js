'use client'

import { useMemo, useState } from 'react'
import {
  Button,
  Chip,
  Input,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Select,
  SelectItem,
  Skeleton,
} from '@heroui/react'
import {
  FaBuilding,
  FaCheckCircle,
  FaCopy,
  FaEdit,
  FaExclamationTriangle,
  FaFingerprint,
  FaKey,
  FaNetworkWired,
  FaPlus,
  FaPowerOff,
  FaSearch,
  FaServer,
  FaSyncAlt,
} from 'react-icons/fa'
import useAuthedSWR from '@/hooks/useAuthedSWR'
import useApiMutation from '@/hooks/useApiMutation'
import LoadingButton from '@/components/ui/LoadingButton'
import { useTheme } from '@/contexts/ThemeContext'
import { toast } from '@/utils/toast'

const MACHINES_API = '/api/settings/attendance-machines'

const EMPTY_FORM = {
  name: '',
  providerKey: '',
  model: '',
  serialNumber: '',
  scope: 'organisation',
  companyId: '',
  locationName: '',
  connectionMode: 'push_http',
  endpointUrl: '',
  host: '',
  port: '',
  siteId: '',
  duplicateWindowSeconds: 30,
  punchDirectionMode: 'first_last',
  employeeCodeField: 'employeeCode',
  credentials: { username: '', password: '', apiKey: '' },
}

function copyText(value, message) {
  if (!value) return
  navigator.clipboard.writeText(value)
    .then(() => toast.success(message))
    .catch(() => toast.error('Could not copy to the clipboard'))
}

function formatLastSeen(value) {
  if (!value) return 'Never connected'
  return new Intl.DateTimeFormat('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Kolkata',
  }).format(new Date(value))
}

export default function AttendanceMachinesSettings() {
  const { isDarkMode } = useTheme()
  const { data, error, isLoading, mutate } = useAuthedSWR(MACHINES_API)
  const { data: companiesResponse, isLoading: companiesLoading } = useAuthedSWR('/api/companies')
  const mutation = useApiMutation({ invalidateKeys: [MACHINES_API] })
  const [scopeFilter, setScopeFilter] = useState('organisation')
  const [companyFilter, setCompanyFilter] = useState('all')
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingMachine, setEditingMachine] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [providerQuery, setProviderQuery] = useState('')
  const [providerListOpen, setProviderListOpen] = useState(false)
  const [setup, setSetup] = useState(null)
  const [busyMachineId, setBusyMachineId] = useState(null)

  const payload = data?.data || {}
  const machines = payload.machines || []
  const providers = payload.providers || []
  const connectionModes = payload.connectionModes || {}
  const companies = companiesResponse?.data || []
  const selectedProvider = providers.find((provider) => provider.key === form.providerKey) || null

  const filteredProviders = useMemo(() => {
    const query = providerQuery.trim().toLowerCase()
    if (!query) return providers
    return providers.filter((provider) => [
      provider.name,
      provider.key,
      ...(provider.models || []),
      ...(provider.keywords || []),
    ].some((value) => String(value).toLowerCase().includes(query)))
  }, [providerQuery, providers])

  const visibleMachines = useMemo(() => machines.filter((machine) => {
    if (machine.scope !== scopeFilter) return false
    if (scopeFilter === 'company' && companyFilter !== 'all') {
      return String(machine.company?._id || machine.company || '') === companyFilter
    }
    return true
  }), [machines, scopeFilter, companyFilter])

  const panelClass = isDarkMode
    ? 'border border-zinc-800 bg-zinc-950 text-zinc-100'
    : 'border border-slate-200 bg-white text-slate-900'
  const insetClass = isDarkMode
    ? 'border border-zinc-800 bg-zinc-900/80'
    : 'border border-slate-200 bg-slate-50'
  const mutedClass = isDarkMode ? 'text-zinc-400' : 'text-slate-600'

  function updateForm(key, value) {
    setForm((current) => ({ ...current, [key]: value }))
  }

  function openCreate(scope = scopeFilter) {
    setEditingMachine(null)
    setForm({ ...EMPTY_FORM, credentials: { ...EMPTY_FORM.credentials }, scope })
    setProviderQuery('')
    setIsModalOpen(true)
  }

  function openEdit(machine) {
    setEditingMachine(machine)
    setForm({
      ...EMPTY_FORM,
      name: machine.name || '',
      providerKey: machine.providerKey || '',
      model: machine.model || '',
      serialNumber: machine.serialNumber || '',
      scope: machine.scope || 'organisation',
      companyId: machine.company?._id || machine.company || '',
      locationName: machine.locationName || '',
      connectionMode: machine.connectionMode || 'push_http',
      endpointUrl: machine.endpointUrl || '',
      host: machine.host || '',
      port: machine.port || '',
      siteId: machine.siteId || '',
      duplicateWindowSeconds: machine.duplicateWindowSeconds || 30,
      punchDirectionMode: machine.punchDirectionMode || 'first_last',
      employeeCodeField: machine.employeeCodeField || 'employeeCode',
      credentials: { username: '', password: '', apiKey: '' },
    })
    setProviderQuery(machine.providerName || '')
    setIsModalOpen(true)
  }

  async function saveMachine() {
    const response = await mutation.execute(
      editingMachine ? `${MACHINES_API}/${editingMachine._id}` : MACHINES_API,
      form,
      { method: editingMachine ? 'PATCH' : 'POST' }
    )
    if (!response) return

    await mutate()
    setIsModalOpen(false)
    toast.success(response.message || (editingMachine ? 'Machine updated' : 'Machine added'))
    if (response.data?.setupToken) {
      setSetup({
        token: response.data.setupToken,
        webhookUrl: response.data.machine?.webhookUrl,
        machineName: response.data.machine?.name,
      })
    }
  }

  async function runMachineAction(machine, action) {
    setBusyMachineId(machine._id)
    try {
      if (action === 'test') {
        const response = await mutation.execute(`${MACHINES_API}/${machine._id}/test`, null, { method: 'POST', invalidateKeys: [] })
        if (response) toast.success(response.message || 'Readiness check completed')
      } else if (action === 'rotate') {
        const response = await mutation.execute(`${MACHINES_API}/${machine._id}`, { rotateSetupToken: true }, { method: 'PATCH' })
        if (response?.data?.setupToken) {
          setSetup({ token: response.data.setupToken, webhookUrl: response.data.machine?.webhookUrl, machineName: machine.name })
          toast.success('Setup token rotated')
        }
      } else {
        const nextStatus = machine.status === 'disabled' ? 'active' : 'disabled'
        const response = await mutation.execute(`${MACHINES_API}/${machine._id}`, { status: nextStatus }, { method: 'PATCH' })
        if (response) toast.success(nextStatus === 'active' ? 'Machine enabled' : 'Machine disabled')
      }
      await mutate()
    } finally {
      setBusyMachineId(null)
    }
  }

  async function importAttendanceFile(machine, file) {
    if (!file) return
    setBusyMachineId(machine._id)
    const formData = new FormData()
    formData.append('file', file)
    try {
      const response = await mutation.execute(`${MACHINES_API}/${machine._id}/import`, formData, { method: 'POST' })
      if (response) toast.success(response.message || 'Attendance file imported')
      await mutate()
    } finally {
      setBusyMachineId(null)
    }
  }

  if (isLoading) {
    return <div className="space-y-4">{[1, 2, 3].map((item) => <Skeleton key={item} className="h-28 rounded-2xl" />)}</div>
  }

  if (error) {
    return (
      <div className={`rounded-2xl p-6 ${panelClass}`}>
        <div className="flex items-start gap-3">
          <FaExclamationTriangle className="mt-1 text-amber-500" />
          <div><h3 className="font-semibold">Attendance machines could not be loaded</h3><p className={`mt-1 text-sm ${mutedClass}`}>{error.message}</p></div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">
              <FaFingerprint className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-xl font-bold">Attendance machines</h2>
              <p className={`text-sm ${mutedClass}`}>Connect multiple devices organisation-wide or assign them to a specific company.</p>
            </div>
          </div>
        </div>
        <Button color="primary" startContent={<FaPlus />} onPress={() => openCreate()} className="justify-center">
          Add machine
        </Button>
      </div>

      {setup && (
        <div className="rounded-2xl border border-emerald-300 bg-emerald-50 p-4 text-emerald-950 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <div className="flex items-center gap-2 font-semibold"><FaKey /> Finish setting up {setup.machineName}</div>
              <p className="mt-1 text-sm opacity-80">Copy this token now. For safety, Talio stores only its hash and cannot display it again.</p>
              <div className="mt-3 grid gap-2">
                <code className="overflow-x-auto rounded-xl bg-black/10 p-3 text-xs dark:bg-black/30">{setup.webhookUrl}</code>
                <code className="overflow-x-auto rounded-xl bg-black/10 p-3 text-xs dark:bg-black/30">Authorization: Bearer {setup.token}</code>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="flat" startContent={<FaCopy />} onPress={() => copyText(setup.webhookUrl, 'Webhook URL copied')}>Copy URL</Button>
              <Button size="sm" variant="flat" startContent={<FaCopy />} onPress={() => copyText(setup.token, 'Setup token copied')}>Copy token</Button>
              <Button size="sm" variant="light" onPress={() => setSetup(null)}>Done</Button>
            </div>
          </div>
        </div>
      )}

      <div className={`rounded-2xl p-2 ${insetClass}`}>
        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={() => setScopeFilter('organisation')} className={`rounded-xl px-4 py-3 text-left transition ${scopeFilter === 'organisation' ? 'bg-indigo-600 text-white shadow-sm' : mutedClass}`}>
            <span className="flex items-center gap-2 font-semibold"><FaServer /> Organisation devices</span>
            <span className="mt-1 block text-xs opacity-75">Available across all companies</span>
          </button>
          <button type="button" onClick={() => setScopeFilter('company')} className={`rounded-xl px-4 py-3 text-left transition ${scopeFilter === 'company' ? 'bg-indigo-600 text-white shadow-sm' : mutedClass}`}>
            <span className="flex items-center gap-2 font-semibold"><FaBuilding /> Company devices</span>
            <span className="mt-1 block text-xs opacity-75">Restricted to one company</span>
          </button>
        </div>
      </div>

      {scopeFilter === 'company' && (
        <Select
          label="Filter by company"
          selectedKeys={[companyFilter]}
          onSelectionChange={(keys) => setCompanyFilter(Array.from(keys)[0] || 'all')}
          isLoading={companiesLoading}
        >
          <SelectItem key="all">All companies</SelectItem>
          {companies.map((company) => <SelectItem key={company._id}>{company.name} ({company.code})</SelectItem>)}
        </Select>
      )}

      {visibleMachines.length === 0 ? (
        <div className={`rounded-2xl border-2 border-dashed p-10 text-center ${isDarkMode ? 'border-zinc-800' : 'border-slate-200'}`}>
          <FaNetworkWired className={`mx-auto h-10 w-10 ${mutedClass}`} />
          <h3 className="mt-4 font-semibold">No {scopeFilter} machines configured</h3>
          <p className={`mx-auto mt-1 max-w-lg text-sm ${mutedClass}`}>Add a machine and choose a secure cloud webhook, vendor API, LAN bridge, or file-import connection.</p>
          <Button className="mt-4 justify-center" color="primary" variant="flat" startContent={<FaPlus />} onPress={() => openCreate(scopeFilter)}>Add the first machine</Button>
        </div>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {visibleMachines.map((machine) => {
            const disabled = machine.status === 'disabled'
            const connectedRecently = machine.lastSeenAt && Date.now() - new Date(machine.lastSeenAt).getTime() < 10 * 60 * 1000
            return (
              <article key={machine._id} className={`rounded-2xl p-5 ${panelClass}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="truncate font-semibold">{machine.name}</h3>
                      <Chip size="sm" color={disabled ? 'default' : connectedRecently ? 'success' : 'warning'} variant="flat">
                        {disabled ? 'Disabled' : connectedRecently ? 'Online' : 'Awaiting sync'}
                      </Chip>
                    </div>
                    <p className={`mt-1 text-sm ${mutedClass}`}>{machine.providerName} · {machine.model}</p>
                  </div>
                  <Button isIconOnly size="sm" variant="light" aria-label={`Edit ${machine.name}`} onPress={() => openEdit(machine)}><FaEdit /></Button>
                </div>

                <dl className={`mt-4 grid grid-cols-2 gap-3 rounded-xl p-3 text-sm ${insetClass}`}>
                  <div><dt className={`text-xs ${mutedClass}`}>Scope</dt><dd className="mt-1 font-medium">{machine.scope === 'company' ? machine.company?.name || 'Company' : 'Organisation'}</dd></div>
                  <div><dt className={`text-xs ${mutedClass}`}>Connection</dt><dd className="mt-1 font-medium">{machine.connection?.label || machine.connectionMode}</dd></div>
                  <div><dt className={`text-xs ${mutedClass}`}>Location</dt><dd className="mt-1 font-medium">{machine.locationName || 'Not specified'}</dd></div>
                  <div><dt className={`text-xs ${mutedClass}`}>Last seen (IST)</dt><dd className="mt-1 font-medium">{formatLastSeen(machine.lastSeenAt)}</dd></div>
                </dl>

                <div className="mt-4 flex flex-wrap gap-2">
                  <LoadingButton size="sm" variant="flat" color="primary" isLoading={busyMachineId === machine._id && mutation.isLoading} loadingText="Checking..." startContent={<FaSyncAlt />} onPress={() => runMachineAction(machine, 'test')}>Check readiness</LoadingButton>
                  <Button size="sm" variant="flat" startContent={<FaKey />} isDisabled={busyMachineId === machine._id} onPress={() => runMachineAction(machine, 'rotate')}>Rotate token</Button>
                  <Button size="sm" variant="light" color={disabled ? 'success' : 'danger'} startContent={disabled ? <FaCheckCircle /> : <FaPowerOff />} isDisabled={busyMachineId === machine._id} onPress={() => runMachineAction(machine, 'toggle')}>
                    {disabled ? 'Enable' : 'Disable'}
                  </Button>
                  {machine.connectionMode === 'file_import' && (
                    <label className="inline-flex h-8 cursor-pointer items-center justify-center gap-2 rounded-lg bg-default-100 px-3 text-sm font-medium transition hover:bg-default-200">
                      <FaPlus /> Import CSV
                      <input
                        className="sr-only"
                        type="file"
                        accept=".csv,text/csv"
                        disabled={disabled || busyMachineId === machine._id}
                        onChange={(event) => {
                          importAttendanceFile(machine, event.target.files?.[0])
                          event.target.value = ''
                        }}
                      />
                    </label>
                  )}
                </div>
              </article>
            )
          })}
        </div>
      )}

      <Modal isOpen={isModalOpen} onOpenChange={setIsModalOpen} size="3xl" scrollBehavior="inside" classNames={{ base: 'rounded-2xl', header: 'rounded-t-2xl', footer: 'rounded-b-2xl' }}>
        <ModalContent>
          <ModalHeader className="flex flex-col gap-1">
            <span>{editingMachine ? 'Edit attendance machine' : 'Add attendance machine'}</span>
            <span className="text-sm font-normal text-default-500">Machine times are normalised and stored consistently in IST.</span>
          </ModalHeader>
          <ModalBody className="gap-5">
            <div className="grid gap-4 md:grid-cols-2">
              <Input label="Machine name" value={form.name} onValueChange={(value) => updateForm('name', value)} isRequired placeholder="Main entrance" />
              <Input label="Location" value={form.locationName} onValueChange={(value) => updateForm('locationName', value)} placeholder="Head office, Gate 1" />
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <Select label="Scope" selectedKeys={[form.scope]} onSelectionChange={(keys) => updateForm('scope', Array.from(keys)[0] || 'organisation')}>
                <SelectItem key="organisation">Organisation-wide</SelectItem>
                <SelectItem key="company">Specific company</SelectItem>
              </Select>
              {form.scope === 'company' && (
                <Select label="Company" selectedKeys={form.companyId ? [form.companyId] : []} onSelectionChange={(keys) => updateForm('companyId', Array.from(keys)[0] || '')} isRequired>
                  {companies.map((company) => <SelectItem key={company._id}>{company.name} ({company.code})</SelectItem>)}
                </Select>
              )}
            </div>

            <div className="relative">
              <Input
                label="Search and select provider"
                value={providerQuery}
                onFocus={() => setProviderListOpen(true)}
                onValueChange={(value) => { setProviderQuery(value); setProviderListOpen(true) }}
                startContent={<FaSearch className="text-default-400" />}
                placeholder="Search ZKTeco, eSSL, Hikvision, Matrix..."
                description={selectedProvider ? `${selectedProvider.name} selected` : 'Search by provider, protocol, or model family'}
                isRequired
              />
              {providerListOpen && (
                <div className="absolute z-50 mt-1 max-h-64 w-full overflow-y-auto rounded-xl border border-default-200 bg-content1 p-1 shadow-xl">
                  {filteredProviders.length === 0 ? (
                    <div className="p-4 text-sm text-default-500">No matching provider. Choose Other / Custom device.</div>
                  ) : filteredProviders.map((provider) => (
                    <button
                      type="button"
                      key={provider.key}
                      onClick={() => {
                        updateForm('providerKey', provider.key)
                        updateForm('connectionMode', provider.modes[0])
                        setProviderQuery(provider.name)
                        setProviderListOpen(false)
                      }}
                      className={`w-full rounded-lg p-3 text-left hover:bg-default-100 ${form.providerKey === provider.key ? 'bg-primary-50 text-primary-700' : ''}`}
                    >
                      <span className="font-medium">{provider.name}</span>
                      <span className="mt-1 block truncate text-xs text-default-500">{provider.models.slice(0, 4).join(' · ')}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <Input
                label="Model"
                value={form.model}
                onValueChange={(value) => updateForm('model', value)}
                list="attendance-machine-models"
                placeholder="Select or enter a model"
                isRequired
              />
              <datalist id="attendance-machine-models">{selectedProvider?.models.map((model) => <option key={model} value={model} />)}</datalist>
              <Input label="Serial number" value={form.serialNumber} onValueChange={(value) => updateForm('serialNumber', value)} placeholder="Optional but recommended" />
            </div>

            <Select
              label="Connection mode"
              selectedKeys={form.connectionMode ? [form.connectionMode] : []}
              onSelectionChange={(keys) => updateForm('connectionMode', Array.from(keys)[0] || '')}
              description={form.connectionMode === 'lan_bridge' ? 'The bridge makes an outbound HTTPS connection; Vercel never connects to your private LAN.' : connectionModes[form.connectionMode]?.description}
              isRequired
            >
              {(selectedProvider?.modes || Object.keys(connectionModes)).map((mode) => <SelectItem key={mode}>{connectionModes[mode]?.label || mode}</SelectItem>)}
            </Select>

            {form.connectionMode === 'cloud_api' && (
              <div className="grid gap-4 md:grid-cols-2">
                <Input label="Vendor HTTPS endpoint" value={form.endpointUrl} onValueChange={(value) => updateForm('endpointUrl', value)} placeholder="https://api.vendor.example" />
                <Input label="Site / tenant ID" value={form.siteId} onValueChange={(value) => updateForm('siteId', value)} />
              </div>
            )}
            {form.connectionMode === 'lan_bridge' && (
              <div className="grid gap-4 md:grid-cols-2">
                <Input label="Machine LAN host" value={form.host} onValueChange={(value) => updateForm('host', value)} placeholder="192.168.1.50" />
                <Input label="Port" type="number" value={String(form.port)} onValueChange={(value) => updateForm('port', value)} placeholder="4370" />
              </div>
            )}

            {['cloud_api', 'lan_bridge'].includes(form.connectionMode) && (
              <div className="grid gap-4 md:grid-cols-3">
                <Input label="Username" value={form.credentials.username} onValueChange={(value) => setForm((current) => ({ ...current, credentials: { ...current.credentials, username: value } }))} placeholder={editingMachine?.credentialsConfigured ? 'Leave blank to keep' : ''} />
                <Input label="Password" type="password" value={form.credentials.password} onValueChange={(value) => setForm((current) => ({ ...current, credentials: { ...current.credentials, password: value } }))} placeholder={editingMachine?.credentialsConfigured ? 'Leave blank to keep' : ''} />
                <Input label="API key" type="password" value={form.credentials.apiKey} onValueChange={(value) => setForm((current) => ({ ...current, credentials: { ...current.credentials, apiKey: value } }))} placeholder={editingMachine?.credentialsConfigured ? 'Leave blank to keep' : ''} />
              </div>
            )}

            <div className={`rounded-xl p-4 ${insetClass}`}>
              <div className="grid gap-4 md:grid-cols-3">
                <Input label="Employee code field" value={form.employeeCodeField} onValueChange={(value) => updateForm('employeeCodeField', value)} />
                <Input label="Duplicate window (seconds)" type="number" min={1} max={3600} value={String(form.duplicateWindowSeconds)} onValueChange={(value) => updateForm('duplicateWindowSeconds', value)} />
                <Select label="Punch interpretation" selectedKeys={[form.punchDirectionMode]} onSelectionChange={(keys) => updateForm('punchDirectionMode', Array.from(keys)[0] || 'first_last')}>
                  <SelectItem key="first_last">First in / last out</SelectItem>
                  <SelectItem key="device">Use device direction</SelectItem>
                  <SelectItem key="alternate">Alternate in / out</SelectItem>
                </Select>
              </div>
            </div>
          </ModalBody>
          <ModalFooter className="gap-2">
            <Button variant="light" onPress={() => setIsModalOpen(false)}>Cancel</Button>
            <LoadingButton color="primary" isLoading={mutation.isLoading} loadingText={editingMachine ? 'Saving...' : 'Adding...'} onPress={saveMachine} className="min-w-32 justify-center">
              {editingMachine ? 'Save changes' : 'Add machine'}
            </LoadingButton>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  )
}
