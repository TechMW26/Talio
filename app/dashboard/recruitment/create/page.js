'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Button, Input, Select, SelectItem, Textarea, Chip, Checkbox,
  Card, CardBody, CardHeader, Skeleton
} from '@heroui/react';
import toast from '@/utils/toast';
import { FaArrowLeft, FaSave, FaPlus, FaTimes } from 'react-icons/fa';
import { HiOutlineSparkles } from 'react-icons/hi2';
import useAuthedSWR from '@/hooks/useAuthedSWR';
import useApiMutation from '@/hooks/useApiMutation';
import { useAILoading } from '@/contexts/AILoadingContext';

export default function CreateJobPage() {
  const router = useRouter();
  const [generatingDescription, setGeneratingDescription] = useState(false);
  const { startAILoading, stopAILoading } = useAILoading();
  const [formData, setFormData] = useState({
    jobTitle: '',
    jobCode: '',
    department: '',
    designation: '',
    numberOfPositions: 1,
    jobDescription: '',
    requirements: [''],
    responsibilities: [''],
    benefits: [''],
    skills: [''],
    educationLevel: 'any',
    experience: { min: 0, max: 0 },
    salaryRange: { min: '', max: '', currency: 'INR', isConfidential: false },
    location: '',
    workMode: 'on-site',
    employmentType: 'full-time',
    status: 'draft',
    applicationDeadline: '',
    hiringManager: '',
  });

  // Fetch dropdown data
  const { data: deptRes, isLoading: deptLoading } = useAuthedSWR('/api/departments');
  const { data: desigRes, isLoading: desigLoading } = useAuthedSWR('/api/designations');
  const { data: empRes, isLoading: empLoading } = useAuthedSWR('/api/employees');
  const departments = deptRes?.data || [];
  const designations = desigRes?.data || [];
  const employees = empRes?.data || [];
  const formLoading = deptLoading || desigLoading || empLoading;

  const updateField = (field, value) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const addArrayItem = (field) => {
    setFormData((prev) => ({ ...prev, [field]: [...prev[field], ''] }));
  };

  const updateArrayItem = (field, index, value) => {
    setFormData((prev) => {
      const arr = [...prev[field]];
      arr[index] = value;
      return { ...prev, [field]: arr };
    });
  };

  const removeArrayItem = (field, index) => {
    setFormData((prev) => {
      const arr = prev[field].filter((_, i) => i !== index);
      return { ...prev, [field]: arr.length === 0 ? [''] : arr };
    });
  };

  const submitMutation = useApiMutation({
    method: 'POST',
    onSuccess: (data, { publish } = {}) => {
      toast.success(publish ? 'Job published successfully' : 'Job saved as draft');
      router.push('/dashboard/recruitment');
    },
    onError: (msg) => toast.error(msg || 'Failed to create job posting'),
  });

  const handleSubmit = async (publish = false) => {
    if (!formData.jobTitle.trim()) { toast.error('Job title is required'); return; }
    if (!formData.department) { toast.error('Department is required'); return; }
    if (!formData.jobDescription.trim()) { toast.error('Job description is required'); return; }

    const payload = {
      ...formData,
      status: publish ? 'open' : 'draft',
      requirements: formData.requirements.filter((r) => r.trim()),
      responsibilities: formData.responsibilities.filter((r) => r.trim()),
      benefits: formData.benefits.filter((b) => b.trim()),
      skills: formData.skills.filter((s) => s.trim()),
      salaryRange: {
        ...formData.salaryRange,
        min: formData.salaryRange.min ? parseFloat(formData.salaryRange.min) : undefined,
        max: formData.salaryRange.max ? parseFloat(formData.salaryRange.max) : undefined,
      },
      applicationDeadline: formData.applicationDeadline || undefined,
    };
    if (!payload.jobCode) delete payload.jobCode;
    if (!payload.designation) delete payload.designation;
    if (!payload.hiringManager) delete payload.hiringManager;
    if (!payload.location) delete payload.location;

    submitMutation.execute('/api/recruitment', payload);
  };

  if (formLoading) {
    return (
      <div className="page-container max-w-4xl mx-auto">
        <div className="space-y-4 sm:space-y-6">
          <Skeleton className="h-10 w-56 rounded-lg" />
          <Skeleton className="h-64 rounded-xl" />
          <Skeleton className="h-40 rounded-xl" />
          <Skeleton className="h-32 rounded-xl" />
        </div>
      </div>
    );
  }

  return (
    <div className="page-container max-w-4xl mx-auto">
      <div className="space-y-4 sm:space-y-6">
        {/* Header */}
        <div className="flex md:justify-between md:items-center md:flex-row flex-col gap-4">
          <div className="flex items-center gap-3">
            <Button isIconOnly variant="light" size="sm" onPress={() => router.push('/dashboard/recruitment')}>
              <FaArrowLeft className="w-4 h-4" />
            </Button>
            <h1 className="text-2xl sm:text-3xl font-bold text-default-800">Create Job Posting</h1>
          </div>
          <div className="flex gap-2 ml-10 md:ml-0">
            <Button variant="flat" onPress={() => handleSubmit(false)} isLoading={submitMutation.isLoading} startContent={<FaSave className="w-3.5 h-3.5" />}>
              Save as Draft
            </Button>
            <Button color="primary" onPress={() => handleSubmit(true)} isLoading={submitMutation.isLoading}>
              Publish Job
            </Button>
          </div>
        </div>

        {/* Basic Info */}
        <Card shadow="sm">
          <CardHeader className="border-b border-default-200 px-4 sm:px-5 py-3">
            <h2 className="text-base font-semibold text-default-800">Basic Information</h2>
          </CardHeader>
          <CardBody className="p-4 sm:p-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2">
                <Input label="Job Title" isRequired size="sm" placeholder="e.g. Senior Software Engineer"
                  value={formData.jobTitle} onValueChange={(v) => updateField('jobTitle', v)} />
              </div>
              <Input label="Job Code" size="sm" placeholder="Auto-generated if empty"
                value={formData.jobCode} onValueChange={(v) => updateField('jobCode', v)} />
              <Input label="Number of Positions" type="number" size="sm" min={1}
                value={String(formData.numberOfPositions)} onValueChange={(v) => updateField('numberOfPositions', parseInt(v) || 1)} />
              <Select label="Department" isRequired size="sm"
                selectedKeys={formData.department ? [formData.department] : []}
                onSelectionChange={(keys) => updateField('department', Array.from(keys)[0] || '')}>
                {departments.map((dept) => <SelectItem key={dept._id}>{dept.name}</SelectItem>)}
              </Select>
              <Select label="Designation" size="sm"
                selectedKeys={formData.designation ? [formData.designation] : []}
                onSelectionChange={(keys) => updateField('designation', Array.from(keys)[0] || '')}>
                {designations.map((desig) => <SelectItem key={desig._id}>{desig.title}</SelectItem>)}
              </Select>
              <Select label="Employment Type" size="sm"
                selectedKeys={[formData.employmentType]}
                onSelectionChange={(keys) => updateField('employmentType', Array.from(keys)[0])}>
                <SelectItem key="full-time">Full-time</SelectItem>
                <SelectItem key="part-time">Part-time</SelectItem>
                <SelectItem key="contract">Contract</SelectItem>
                <SelectItem key="internship">Internship</SelectItem>
                <SelectItem key="freelance">Freelance</SelectItem>
              </Select>
              <Select label="Work Mode" size="sm"
                selectedKeys={[formData.workMode]}
                onSelectionChange={(keys) => updateField('workMode', Array.from(keys)[0])}>
                <SelectItem key="on-site">On-site</SelectItem>
                <SelectItem key="remote">Remote</SelectItem>
                <SelectItem key="hybrid">Hybrid</SelectItem>
              </Select>
              <Input label="Location" size="sm" placeholder="e.g. Mumbai, India"
                value={formData.location} onValueChange={(v) => updateField('location', v)} />
              <Select label="Education Level" size="sm"
                selectedKeys={[formData.educationLevel]}
                onSelectionChange={(keys) => updateField('educationLevel', Array.from(keys)[0])}>
                <SelectItem key="any">Any</SelectItem>
                <SelectItem key="high-school">High School</SelectItem>
                <SelectItem key="associate">Associate</SelectItem>
                <SelectItem key="bachelor">Bachelor&apos;s</SelectItem>
                <SelectItem key="master">Master&apos;s</SelectItem>
                <SelectItem key="doctorate">Doctorate</SelectItem>
              </Select>
              <Input label="Application Deadline" type="date" size="sm"
                value={formData.applicationDeadline} onValueChange={(v) => updateField('applicationDeadline', v)} />
              <Select label="Hiring Manager" size="sm"
                selectedKeys={formData.hiringManager ? [formData.hiringManager] : []}
                onSelectionChange={(keys) => updateField('hiringManager', Array.from(keys)[0] || '')}>
                {employees.map((emp) => <SelectItem key={emp._id}>{emp.firstName} {emp.lastName}</SelectItem>)}
              </Select>
            </div>
          </CardBody>
        </Card>

        {/* Experience & Salary */}
        <Card shadow="sm">
          <CardHeader className="border-b border-default-200 px-4 sm:px-5 py-3">
            <h2 className="text-base font-semibold text-default-800">Experience & Compensation</h2>
          </CardHeader>
          <CardBody className="p-4 sm:p-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Input label="Min Experience (years)" type="number" size="sm" min={0}
                value={String(formData.experience.min)}
                onValueChange={(v) => setFormData((p) => ({ ...p, experience: { ...p.experience, min: parseInt(v) || 0 } }))} />
              <Input label="Max Experience (years)" type="number" size="sm" min={0}
                value={String(formData.experience.max)}
                onValueChange={(v) => setFormData((p) => ({ ...p, experience: { ...p.experience, max: parseInt(v) || 0 } }))} />
              <Input label="Min Salary" type="number" size="sm"
                value={formData.salaryRange.min}
                onValueChange={(v) => setFormData((p) => ({ ...p, salaryRange: { ...p.salaryRange, min: v } }))} />
              <Input label="Max Salary" type="number" size="sm"
                value={formData.salaryRange.max}
                onValueChange={(v) => setFormData((p) => ({ ...p, salaryRange: { ...p.salaryRange, max: v } }))} />
              <Select label="Currency" size="sm"
                selectedKeys={[formData.salaryRange.currency]}
                onSelectionChange={(keys) => setFormData((p) => ({ ...p, salaryRange: { ...p.salaryRange, currency: Array.from(keys)[0] } }))}>
                <SelectItem key="INR">INR</SelectItem>
                <SelectItem key="USD">USD</SelectItem>
                <SelectItem key="EUR">EUR</SelectItem>
                <SelectItem key="GBP">GBP</SelectItem>
              </Select>
              <div className="flex items-center pt-6">
                <Checkbox
                  isSelected={formData.salaryRange.isConfidential}
                  onValueChange={(v) => setFormData((p) => ({ ...p, salaryRange: { ...p.salaryRange, isConfidential: v } }))}>
                  Salary is confidential
                </Checkbox>
              </div>
            </div>
          </CardBody>
        </Card>

        {/* Description */}
        <Card shadow="sm">
          <CardHeader className="border-b border-default-200 px-4 sm:px-5 py-3 flex justify-between items-center">
            <h2 className="text-base font-semibold text-default-800">Job Description</h2>
            <Button
              size="sm"
              variant="flat"
              onPress={async () => {
                if (!formData.jobTitle.trim()) { toast.error('Please enter a job title first'); return }
                setGeneratingDescription(true)
                startAILoading('MIRA is writing job description...')
                try {
                  const token = localStorage.getItem('token')
                  const res = await fetch('/api/ai/generate-text', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                    body: JSON.stringify({ type: 'job_description', context: { jobTitle: formData.jobTitle, department: formData.department, employmentType: formData.employmentType } })
                  })
                  const data = await res.json()
                  if (data.success && data.text) {
                    updateField('jobDescription', data.text)
                    toast.success('Description generated!')
                  } else { toast.error(data.message || 'Failed to generate description') }
                } catch (err) { console.error('AI generate error:', err); toast.error('Failed to generate description') }
                finally { setGeneratingDescription(false); stopAILoading() }
              }}
              isDisabled={generatingDescription || !formData.jobTitle.trim()}
              isLoading={generatingDescription}
              startContent={!generatingDescription && <HiOutlineSparkles className="w-3.5 h-3.5" />}
              className="bg-gradient-to-r from-purple-600 to-indigo-600 text-white"
            >
              {generatingDescription ? 'Writing...' : 'AI Write'}
            </Button>
          </CardHeader>
          <CardBody className="p-4 sm:p-5">
            <Textarea isRequired size="sm" minRows={4}
              placeholder="Describe the role, team, and what the ideal candidate will do..."
              value={formData.jobDescription} onValueChange={(v) => updateField('jobDescription', v)} />
          </CardBody>
        </Card>

        {/* Skills */}
        <Card shadow="sm">
          <CardHeader className="border-b border-default-200 px-4 sm:px-5 py-3 flex justify-between items-center">
            <h2 className="text-base font-semibold text-default-800">Skills</h2>
            <Button size="sm" variant="flat" onPress={() => addArrayItem('skills')} startContent={<FaPlus className="w-3 h-3" />}>
              Add Skill
            </Button>
          </CardHeader>
          <CardBody className="p-4 sm:p-5">
            {formData.skills.filter((s) => s.trim()).length > 0 && (
              <div className="flex flex-wrap gap-2 mb-3">
                {formData.skills.filter((s) => s.trim()).map((skill, i) => (
                  <Chip key={i} onClose={() => removeArrayItem('skills', i)} variant="flat" color="primary">{skill}</Chip>
                ))}
              </div>
            )}
            <div className="space-y-2">
              {formData.skills.map((skill, index) => (
                <div key={index} className="flex gap-2">
                  <Input size="sm" placeholder={`Skill ${index + 1}`} value={skill}
                    onValueChange={(v) => updateArrayItem('skills', index, v)} />
                  {formData.skills.length > 1 && (
                    <Button size="sm" isIconOnly variant="light" color="danger" onPress={() => removeArrayItem('skills', index)}>
                      <FaTimes className="w-3 h-3" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </CardBody>
        </Card>

        {/* Requirements, Responsibilities, Benefits */}
        {[
          { key: 'requirements', label: 'Requirements', placeholder: 'Requirement' },
          { key: 'responsibilities', label: 'Responsibilities', placeholder: 'Responsibility' },
          { key: 'benefits', label: 'Benefits', placeholder: 'Benefit' },
        ].map(({ key, label, placeholder }) => (
          <Card key={key} shadow="sm">
            <CardHeader className="border-b border-default-200 px-4 sm:px-5 py-3 flex justify-between items-center">
              <h2 className="text-base font-semibold text-default-800">{label}</h2>
              <Button size="sm" variant="flat" onPress={() => addArrayItem(key)} startContent={<FaPlus className="w-3 h-3" />}>
                Add
              </Button>
            </CardHeader>
            <CardBody className="p-4 sm:p-5">
              <div className="space-y-2">
                {formData[key].map((item, index) => (
                  <div key={index} className="flex gap-2">
                    <Input size="sm" placeholder={`${placeholder} ${index + 1}`}
                      value={item} onValueChange={(v) => updateArrayItem(key, index, v)} />
                    {formData[key].length > 1 && (
                      <Button size="sm" isIconOnly variant="light" color="danger" onPress={() => removeArrayItem(key, index)}>
                        <FaTimes className="w-3 h-3" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </CardBody>
          </Card>
        ))}

        {/* Bottom Actions */}
        <div className="flex justify-end gap-3 pb-8">
          <Button variant="flat" onPress={() => router.push('/dashboard/recruitment')}>Cancel</Button>
          <Button variant="flat" onPress={() => handleSubmit(false)} isLoading={submitMutation.isLoading} startContent={<FaSave className="w-3.5 h-3.5" />}>
            Save as Draft
          </Button>
          <Button color="primary" onPress={() => handleSubmit(true)} isLoading={submitMutation.isLoading}>
            Publish Job
          </Button>
        </div>
      </div>
    </div>
  );
}
