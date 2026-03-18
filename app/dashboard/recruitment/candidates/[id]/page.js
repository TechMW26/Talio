'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter, useParams } from 'next/navigation';
import {
  Button, Chip, Divider, Modal, ModalContent, ModalHeader,
  ModalBody, ModalFooter, useDisclosure, Select, SelectItem,
  Textarea, Input, Card, CardBody, CardHeader, Skeleton, Tooltip
} from '@heroui/react';
import toast from '@/utils/toast';
import { useSocket, REALTIME_EVENTS } from '@/contexts/SocketContext';
import useAuthedSWR from '@/hooks/useAuthedSWR';
import useApiMutation from '@/hooks/useApiMutation';
import LoadingButton from '@/components/ui/LoadingButton';
import { DataErrorState } from '@/components/ui/ErrorBoundary';
import BackgroundRefreshIndicator from '@/components/ui/BackgroundRefreshIndicator';
import {
  FaArrowLeft, FaEdit, FaTrash, FaUser, FaEnvelope, FaPhone,
  FaBriefcase, FaStar, FaCalendarAlt, FaDollarSign, FaClock,
  FaGraduationCap, FaPlus, FaChevronRight, FaFileAlt, FaExternalLinkAlt,
  FaUserCheck
} from 'react-icons/fa';

const STAGE_COLOR = {
  applied: 'primary', screening: 'secondary', shortlisted: 'warning',
  interview: 'primary', assessment: 'secondary', offer: 'success',
  hired: 'success', rejected: 'danger', withdrawn: 'default',
};

const STAGES = [
  'applied', 'screening', 'shortlisted', 'interview',
  'assessment', 'offer', 'hired', 'rejected', 'withdrawn',
];

export default function CandidateDetailPage() {
  const router = useRouter();
  const params = useParams();

  // Stage change modal
  const { isOpen: isStageOpen, onOpen: onStageOpen, onClose: onStageClose } = useDisclosure();
  const [newStage, setNewStage] = useState('');
  const [stageNotes, setStageNotes] = useState('');

  // Note modal
  const { isOpen: isNoteOpen, onOpen: onNoteOpen, onClose: onNoteClose } = useDisclosure();
  const [noteText, setNoteText] = useState('');

  // Rating modal
  const { isOpen: isRatingOpen, onOpen: onRatingOpen, onClose: onRatingClose } = useDisclosure();
  const [ratingValue, setRatingValue] = useState('');

  // Convert modal
  const { isOpen: isConvertOpen, onOpen: onConvertOpen, onClose: onConvertClose } = useDisclosure();
  const [convertData, setConvertData] = useState({ employeeCode: '', joiningDate: '' });

  const { socket, isConnected, subscribe } = useSocket();

  const user = useMemo(() => {
    try { return JSON.parse(localStorage.getItem('user')); } catch { return null; }
  }, []);

  const { data: res, error, isLoading, isValidating, mutate: refresh } = useAuthedSWR(params.id ? `/api/recruitment/candidates/${params.id}` : null);
  const candidate = res?.data || null;

  useEffect(() => {
    if (!socket || !isConnected) return;
    const unsub = subscribe?.(REALTIME_EVENTS.RECRUITMENT_CANDIDATE_STAGE_CHANGED, () => refresh());
    return () => unsub?.();
  }, [socket, isConnected]);

  const canManage = user && ['admin', 'hr', 'manager'].includes(user.role);

  const stageMutation = useApiMutation({
    method: 'PUT',
    invalidateKeys: [`/api/recruitment/candidates/${params.id}`],
    onSuccess: () => { toast.success('Stage updated'); onStageClose(); setStageNotes(''); },
    onError: (msg) => toast.error(msg || 'Failed to update stage'),
  });

  const handleStageChange = async () => {
    if (!newStage) return;
    await stageMutation.execute(`/api/recruitment/candidates/${params.id}`, { stage: newStage, stageNotes });
  };

  const noteMutation = useApiMutation({
    method: 'PUT',
    invalidateKeys: [`/api/recruitment/candidates/${params.id}`],
    onSuccess: () => { toast.success('Note added'); onNoteClose(); setNoteText(''); },
    onError: (msg) => toast.error(msg || 'Failed to add note'),
  });

  const handleAddNote = async () => {
    if (!noteText.trim()) return;
    await noteMutation.execute(`/api/recruitment/candidates/${params.id}`, { addNote: noteText });
  };

  const ratingMutation = useApiMutation({
    method: 'PUT',
    invalidateKeys: [`/api/recruitment/candidates/${params.id}`],
    onSuccess: () => { toast.success('Rating updated'); onRatingClose(); },
    onError: (msg) => toast.error(msg || 'Failed to update rating'),
  });

  const handleUpdateRating = async () => {
    const rating = Number(ratingValue);
    if (!rating || rating < 1 || rating > 5) { toast.error('Rating must be 1-5'); return; }
    await ratingMutation.execute(`/api/recruitment/candidates/${params.id}`, { rating });
  };

  const convertMutation = useApiMutation({
    method: 'POST',
    invalidateKeys: [`/api/recruitment/candidates/${params.id}`],
    onSuccess: () => { toast.success('Candidate converted to employee!'); onConvertClose(); },
    onError: (msg) => toast.error(msg || 'Failed to convert candidate'),
  });

  const handleConvert = async () => {
    if (!convertData.employeeCode || !convertData.joiningDate) {
      toast.error('Employee code and joining date are required');
      return;
    }
    await convertMutation.execute('/api/recruitment/candidates/convert', { candidateId: params.id, ...convertData });
  };

  const deleteMutation = useApiMutation({
    method: 'DELETE',
    onSuccess: () => { toast.success('Candidate deleted'); router.push('/dashboard/recruitment/candidates'); },
    onError: (msg) => toast.error(msg || 'Failed to delete candidate'),
  });

  const handleDelete = async () => {
    if (!confirm('Are you sure you want to delete this candidate?')) return;
    await deleteMutation.execute(`/api/recruitment/candidates/${params.id}`);
  };

  if (isLoading) {
    return (
      <div className="page-container">
        <div className="space-y-4 sm:space-y-6">
          <Skeleton className="h-10 w-64 rounded-lg" />
          <Skeleton className="h-6 w-96 rounded-lg" />
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
            <div className="lg:col-span-2 space-y-4">
              <Skeleton className="h-24 rounded-xl" />
              <Skeleton className="h-48 rounded-xl" />
              <Skeleton className="h-40 rounded-xl" />
            </div>
            <div className="space-y-4">
              <Skeleton className="h-48 rounded-xl" />
              <Skeleton className="h-24 rounded-xl" />
              <Skeleton className="h-24 rounded-xl" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="page-container">
        <DataErrorState message="Failed to load candidate details" onRetry={() => refresh()} />
      </div>
    );
  }

  if (!candidate) {
    return (
      <div className="page-container">
        <Card shadow="sm">
          <CardBody className="p-8 sm:p-12 text-center">
            <div className="w-16 h-16 rounded-full bg-default-100 flex items-center justify-center mx-auto mb-4">
              <FaUser className="w-7 h-7 text-default-400" />
            </div>
            <h1 className="text-2xl font-bold text-default-800 mb-2">Candidate Not Found</h1>
            <Button color="primary" onPress={() => router.push('/dashboard/recruitment/candidates')}>
              Back to Candidates
            </Button>
          </CardBody>
        </Card>
      </div>
    );
  }

  return (
    <div className="page-container">
      <div className="space-y-4 sm:space-y-6">
        {/* Header */}
        <div className="flex md:justify-between md:items-start md:flex-row flex-col gap-4">
          <div className="flex items-start gap-3">
            <Button isIconOnly variant="light" size="sm" onPress={() => router.back()} className="mt-0.5">
              <FaArrowLeft className="w-4 h-4" />
            </Button>
            <div>
              <div className="flex items-center flex-wrap gap-2">
                <h1 className="text-2xl sm:text-3xl font-bold text-default-800">
                  {candidate.firstName} {candidate.lastName}
                </h1>
                <Chip size="sm" variant="flat" color={STAGE_COLOR[candidate.stage]} className="capitalize">
                  {candidate.stage}
                </Chip>
                {candidate.convertedEmployeeId && (
                  <Chip size="sm" variant="flat" color="success" startContent={<FaUserCheck className="w-3 h-3" />}>
                    Converted
                  </Chip>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-3 mt-1 text-sm text-default-500">
                <span className="flex items-center gap-1.5"><FaEnvelope className="w-3 h-3 text-default-400" />{candidate.email}</span>
                {candidate.phone && (
                  <span className="flex items-center gap-1.5"><FaPhone className="w-3 h-3 text-default-400" />{candidate.phone}</span>
                )}
                {candidate.rating > 0 && (
                  <span className="flex items-center gap-1 text-warning">
                    <FaStar className="w-3.5 h-3.5" />{candidate.rating}/5
                  </span>
                )}
              </div>
            </div>
          </div>
          {canManage && (
            <div className="flex flex-wrap items-center gap-2 ml-10 md:ml-0">
              <Button size="sm" color="primary" variant="flat" onPress={() => { setNewStage(candidate.stage); onStageOpen(); }}>
                Change Stage
              </Button>
              <Button size="sm" variant="flat" onPress={onRatingOpen}>Rate</Button>
              {candidate.stage === 'hired' && !candidate.convertedEmployeeId && (
                <Button size="sm" color="success" variant="flat" onPress={onConvertOpen} startContent={<FaUserCheck className="w-3 h-3" />}>
                  Convert to Employee
                </Button>
              )}
              <Button size="sm" color="danger" variant="light" isLoading={deleteMutation.isLoading} onPress={handleDelete}>
                Delete
              </Button>
            </div>
          )}
        </div>
        <BackgroundRefreshIndicator isValidating={isValidating && !isLoading} position="inline" />

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
          {/* Main content - 2/3 */}
          <div className="lg:col-span-2 space-y-4 sm:space-y-6">
            {/* Applied For */}
            {candidate.jobPosting && (
              <Card shadow="sm">
                <CardHeader className="border-b border-default-200 px-4 sm:px-5 py-3">
                  <h3 className="text-sm font-semibold text-default-700">Applied For</h3>
                </CardHeader>
                <CardBody className="p-4 sm:p-5">
                  <Card
                    shadow="none"
                    isPressable
                    onPress={() => router.push(`/dashboard/recruitment/${candidate.jobPosting._id}`)}
                    className="bg-primary-50 border border-primary-100"
                  >
                    <CardBody className="p-3 flex flex-row items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-default-800">{candidate.jobPosting.jobTitle}</p>
                        <p className="text-xs text-default-500">{candidate.jobPosting.department?.name}</p>
                      </div>
                      <FaChevronRight className="w-3 h-3 text-default-400" />
                    </CardBody>
                  </Card>
                </CardBody>
              </Card>
            )}

            {/* Stage History */}
            <Card shadow="sm">
              <CardHeader className="border-b border-default-200 px-4 sm:px-5 py-3">
                <h3 className="text-sm font-semibold text-default-700">Stage History</h3>
              </CardHeader>
              <CardBody className="p-4 sm:p-5">
                {candidate.stageHistory?.length > 0 ? (
                  <div className="relative pl-6 space-y-4">
                    <div className="absolute left-2 top-2 bottom-2 w-0.5 bg-default-200" />
                    {candidate.stageHistory.slice().reverse().map((entry, i) => (
                      <div key={i} className="relative">
                        <div className="absolute -left-4 top-1 w-3 h-3 rounded-full bg-primary border-2 border-content1" />
                        <div>
                          <p className="text-sm font-medium text-default-800 capitalize">{entry.stage}</p>
                          <p className="text-xs text-default-400">
                            {new Date(entry.movedAt).toLocaleString()}
                            {entry.movedBy ? ` by ${entry.movedBy.firstName || 'System'}` : ''}
                          </p>
                          {entry.notes && <p className="text-xs text-default-500 mt-0.5">{entry.notes}</p>}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-default-400">No stage transitions recorded</p>
                )}
              </CardBody>
            </Card>

            {/* Interviews */}
            {candidate.interviews?.length > 0 && (
              <Card shadow="sm">
                <CardHeader className="border-b border-default-200 px-4 sm:px-5 py-3">
                  <h3 className="text-sm font-semibold text-default-700">Interviews</h3>
                </CardHeader>
                <CardBody className="p-4 sm:p-5 space-y-3">
                  {candidate.interviews.map((interview) => (
                    <Card key={interview._id} shadow="none" className="border border-default-200">
                      <CardBody className="p-3">
                        <div className="flex justify-between items-start">
                          <div>
                            <p className="text-sm font-medium text-default-800">{interview.title || `Round ${interview.round}`}</p>
                            <p className="text-xs text-default-500 capitalize">{interview.type} interview</p>
                          </div>
                          <Chip size="sm" variant="flat" color={
                            interview.status === 'completed' ? 'success' :
                              interview.status === 'cancelled' ? 'danger' : 'primary'
                          }>
                            {interview.status}
                          </Chip>
                        </div>
                        <p className="text-xs text-default-400 mt-1">
                          <FaCalendarAlt className="inline w-3 h-3 mr-1" />
                          {new Date(interview.scheduledDate).toLocaleString()}
                        </p>
                        {interview.feedback?.length > 0 && (
                          <div className="mt-2 pt-2 border-t border-default-100">
                            {interview.feedback.map((fb, i) => (
                              <div key={i} className="text-xs text-default-600 mt-1">
                                <span className="font-medium">{fb.interviewer?.firstName || 'Interviewer'}:</span>
                                {' '}Rating {fb.rating}/5 - {fb.recommendation}
                              </div>
                            ))}
                          </div>
                        )}
                      </CardBody>
                    </Card>
                  ))}
                </CardBody>
              </Card>
            )}

            {/* Notes */}
            <Card shadow="sm">
              <CardHeader className="border-b border-default-200 px-4 sm:px-5 py-3 flex justify-between items-center">
                <h3 className="text-sm font-semibold text-default-700">Notes</h3>
                {canManage && (
                  <Button size="sm" variant="light" color="primary" onPress={onNoteOpen} startContent={<FaPlus className="w-3 h-3" />}>
                    Add Note
                  </Button>
                )}
              </CardHeader>
              <CardBody className="p-4 sm:p-5">
                {candidate.notes?.length > 0 ? (
                  <div className="space-y-3">
                    {candidate.notes.slice().reverse().map((note, i) => (
                      <div key={i} className="p-3 bg-default-50 rounded-lg">
                        <p className="text-sm text-default-700">{note.note}</p>
                        <p className="text-xs text-default-400 mt-1">
                          {note.addedBy?.firstName || 'System'} &middot; {new Date(note.addedAt).toLocaleString()}
                        </p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-default-400">No notes yet</p>
                )}
              </CardBody>
            </Card>
          </div>

          {/* Sidebar - 1/3 */}
          <div className="space-y-4 sm:space-y-6">
            {/* Profile Info */}
            <Card shadow="sm">
              <CardHeader className="border-b border-default-200 px-4 py-3">
                <h3 className="text-sm font-semibold text-default-700">Profile</h3>
              </CardHeader>
              <CardBody className="p-4 space-y-3 text-sm">
                {candidate.currentCompany && (
                  <div className="flex items-center gap-2.5">
                    <FaBriefcase className="w-3.5 h-3.5 text-default-400 flex-shrink-0" />
                    <span className="text-default-600">{candidate.currentCompany}</span>
                  </div>
                )}
                {candidate.currentDesignation && (
                  <div className="flex items-center gap-2.5">
                    <FaUser className="w-3.5 h-3.5 text-default-400 flex-shrink-0" />
                    <span className="text-default-600">{candidate.currentDesignation}</span>
                  </div>
                )}
                {candidate.totalExperience && (
                  <div className="flex items-center gap-2.5">
                    <FaClock className="w-3.5 h-3.5 text-default-400 flex-shrink-0" />
                    <span className="text-default-600">{candidate.totalExperience} years experience</span>
                  </div>
                )}
                {candidate.currentSalary && (
                  <div className="flex items-center gap-2.5">
                    <FaDollarSign className="w-3.5 h-3.5 text-default-400 flex-shrink-0" />
                    <span className="text-default-600">Current: ₹{candidate.currentSalary.toLocaleString()}</span>
                  </div>
                )}
                {candidate.expectedSalary && (
                  <div className="flex items-center gap-2.5">
                    <FaDollarSign className="w-3.5 h-3.5 text-default-400 flex-shrink-0" />
                    <span className="text-default-600">Expected: ₹{candidate.expectedSalary.toLocaleString()}</span>
                  </div>
                )}
                {candidate.noticePeriod && (
                  <div className="flex items-center gap-2.5">
                    <FaCalendarAlt className="w-3.5 h-3.5 text-default-400 flex-shrink-0" />
                    <span className="text-default-600">{candidate.noticePeriod} days notice</span>
                  </div>
                )}
                {candidate.source && (
                  <div className="flex items-center gap-2.5">
                    <FaExternalLinkAlt className="w-3.5 h-3.5 text-default-400 flex-shrink-0" />
                    <span className="text-default-600 capitalize">{candidate.source}</span>
                  </div>
                )}
              </CardBody>
            </Card>

            {/* Skills */}
            {candidate.skills?.length > 0 && (
              <Card shadow="sm">
                <CardHeader className="border-b border-default-200 px-4 py-3">
                  <h3 className="text-sm font-semibold text-default-700">Skills</h3>
                </CardHeader>
                <CardBody className="p-4">
                  <div className="flex flex-wrap gap-1.5">
                    {candidate.skills.map((skill, i) => (
                      <Chip key={i} size="sm" variant="flat" color="primary">{skill}</Chip>
                    ))}
                  </div>
                </CardBody>
              </Card>
            )}

            {/* Resume */}
            {candidate.resume?.url && (
              <Card shadow="sm">
                <CardHeader className="border-b border-default-200 px-4 py-3">
                  <h3 className="text-sm font-semibold text-default-700">Resume</h3>
                </CardHeader>
                <CardBody className="p-4">
                  <a
                    href={candidate.resume.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 text-sm text-primary hover:underline"
                  >
                    <FaFileAlt className="w-4 h-4" />
                    {candidate.resume.name || 'View Resume'}
                  </a>
                </CardBody>
              </Card>
            )}

            {/* Offer Details */}
            {candidate.offer?.offeredDate && (
              <Card shadow="sm">
                <CardHeader className="border-b border-default-200 px-4 py-3">
                  <h3 className="text-sm font-semibold text-default-700">Offer</h3>
                </CardHeader>
                <CardBody className="p-4 space-y-2 text-sm">
                  <div>
                    <p className="text-xs text-default-400">Status</p>
                    <Chip size="sm" variant="flat" color={
                      candidate.offer.status === 'accepted' ? 'success' :
                        candidate.offer.status === 'rejected' ? 'danger' : 'warning'
                    }>
                      {candidate.offer.status}
                    </Chip>
                  </div>
                  {candidate.offer.salary && (
                    <div>
                      <p className="text-xs text-default-400">Offered Salary</p>
                      <p className="font-medium text-default-800">₹{candidate.offer.salary.toLocaleString()}</p>
                    </div>
                  )}
                  {candidate.offer.joiningDate && (
                    <div>
                      <p className="text-xs text-default-400">Joining Date</p>
                      <p className="font-medium text-default-800">{new Date(candidate.offer.joiningDate).toLocaleDateString()}</p>
                    </div>
                  )}
                </CardBody>
              </Card>
            )}

            {/* Tags */}
            {candidate.tags?.length > 0 && (
              <Card shadow="sm">
                <CardHeader className="border-b border-default-200 px-4 py-3">
                  <h3 className="text-sm font-semibold text-default-700">Tags</h3>
                </CardHeader>
                <CardBody className="p-4">
                  <div className="flex flex-wrap gap-1.5">
                    {candidate.tags.map((tag, i) => (
                      <Chip key={i} size="sm" variant="bordered">{tag}</Chip>
                    ))}
                  </div>
                </CardBody>
              </Card>
            )}
          </div>
        </div>

        {/* Stage Change Modal */}
        <Modal isOpen={isStageOpen} onClose={onStageClose}>
          <ModalContent>
            <ModalHeader>Change Candidate Stage</ModalHeader>
            <ModalBody>
              <Select
                label="New Stage"
                selectedKeys={newStage ? [newStage] : []}
                onSelectionChange={(keys) => setNewStage(Array.from(keys)[0] || '')}
              >
                {STAGES.map((s) => (
                  <SelectItem key={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</SelectItem>
                ))}
              </Select>
              <Textarea
                label="Notes (optional)"
                placeholder="Reason for stage change..."
                value={stageNotes}
                onValueChange={setStageNotes}
              />
            </ModalBody>
            <ModalFooter>
              <Button variant="flat" onPress={onStageClose}>Cancel</Button>
              <Button color="primary" isLoading={stageMutation.isLoading} onPress={handleStageChange}>Update Stage</Button>
            </ModalFooter>
          </ModalContent>
        </Modal>

        {/* Add Note Modal */}
        <Modal isOpen={isNoteOpen} onClose={onNoteClose}>
          <ModalContent>
            <ModalHeader>Add Note</ModalHeader>
            <ModalBody>
              <Textarea
                label="Note"
                placeholder="Add your note..."
                value={noteText}
                onValueChange={setNoteText}
                minRows={3}
              />
            </ModalBody>
            <ModalFooter>
              <Button variant="flat" onPress={onNoteClose}>Cancel</Button>
              <Button color="primary" isLoading={noteMutation.isLoading} onPress={handleAddNote}>Add Note</Button>
            </ModalFooter>
          </ModalContent>
        </Modal>

        {/* Rating Modal */}
        <Modal isOpen={isRatingOpen} onClose={onRatingClose}>
          <ModalContent>
            <ModalHeader>Rate Candidate</ModalHeader>
            <ModalBody>
              <Input
                label="Rating (1-5)"
                type="number"
                min={1}
                max={5}
                value={ratingValue}
                onValueChange={setRatingValue}
              />
            </ModalBody>
            <ModalFooter>
              <Button variant="flat" onPress={onRatingClose}>Cancel</Button>
              <Button color="primary" isLoading={ratingMutation.isLoading} onPress={handleUpdateRating}>Update Rating</Button>
            </ModalFooter>
          </ModalContent>
        </Modal>

        {/* Convert to Employee Modal */}
        <Modal isOpen={isConvertOpen} onClose={onConvertClose}>
          <ModalContent>
            <ModalHeader>Convert to Employee</ModalHeader>
            <ModalBody>
              <p className="text-sm text-default-500 mb-3">
                This will create a new employee record for {candidate.firstName} {candidate.lastName}.
              </p>
              <Input
                label="Employee Code"
                isRequired
                placeholder="e.g., EMP-001"
                value={convertData.employeeCode}
                onValueChange={(v) => setConvertData((prev) => ({ ...prev, employeeCode: v }))}
              />
              <Input
                label="Joining Date"
                type="date"
                isRequired
                value={convertData.joiningDate}
                onValueChange={(v) => setConvertData((prev) => ({ ...prev, joiningDate: v }))}
                className="mt-3"
              />
            </ModalBody>
            <ModalFooter>
              <Button variant="flat" onPress={onConvertClose}>Cancel</Button>
              <Button color="success" isLoading={convertMutation.isLoading} onPress={handleConvert}>
                Convert to Employee
              </Button>
            </ModalFooter>
          </ModalContent>
        </Modal>
      </div>
    </div>
  );
}
