'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import {
  Button, Input, Select, SelectItem, Textarea, Chip, Checkbox,
  Card, CardBody, CardHeader, Skeleton
} from '@heroui/react';
import toast from '@/utils/toast';
import { FaArrowLeft, FaSave, FaPlus, FaTimes } from 'react-icons/fa';

export default function EditJobPage() {
  const router = useRouter();
  const params = useParams();
  const [loading, setLoading] = useState(false);
  const [departments, setDepartments] = useState([]);
  const [designations, setDesignations] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [formLoading, setFormLoading] = useState(true);
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

  useEffect(() => { fetchData(); }, []);

  const fetchData = async () => {
    try {
      const token = localStorage.getItem('token');
      const headers = { Authorization: `Bearer ${token}` };
      const [jobRes, deptRes, desigRes, empRes] = await Promise.all([
        fetch(`/api/recruitment/${params.id}`, { headers }),
        fetch('/api/departments', { headers }),
        fetch('/api/designations', { headers }).catch(() => ({ json: async () => ({ success: false }) })),
        fetch('/api/employees', { headers }),
      ]);
      const [jobData, deptData, desigData, empData] = await Promise.all([
        jobRes.json(), deptRes.json(), desigRes.json(), empRes.json(),
      ]);
      if (deptData.success) setDepartments(deptData.data || []);
      if (desigData.success) setDesignations(desigData.data || []);
      if (empData.success) setEmployees(empData.data || []);
      if (jobData.success && jobData.data) {
        const job = jobData.data;
        setFormData({
          jobTitle: job.jobTitle || '',
          jobCode: job.jobCode || '',
          department: job.department?._id || job.department || '',
          designation: job.designation?._id || job.designation || '',
          numberOfPositions: job.numberOfPositions || 1,
          jobDescription: job.jobDescription || '',
          requirements: job.requirements?.length > 0 ? job.requirements : [''],
          responsibilities: job.responsibilities?.length > 0 ? job.responsibilities : [''],
          benefits: job.benefits?.length > 0 ? job.benefits : [''],
          skills: job.skills?.length > 0 ? job.skills : [''],
          educationLevel: job.educationLevel || 'any',
          experience: { min: job.experience?.min || 0, max: job.experience?.max || 0 },
          salaryRange: {
            min: job.salaryRange?.min?.toString() || '',
            max: job.salaryRange?.max?.toString() || '',
            currency: job.salaryRange?.currency || 'INR',
            isConfidential: job.salaryRange?.isConfidential || false,
          },
          location: job.location || '',
          workMode: job.workMode || 'on-site',
          employmentType: job.employmentType || 'full-time',
          status: job.status || 'draft',
          applicationDeadline: job.applicationDeadline ? job.applicationDeadline.split('T')[0] : '',
          hiringManager: job.hiringManager?._id || job.hiringManager || '',
        });
      } else {
        toast.error('Job posting not found');
        router.push('/dashboard/recruitment');
      }
    } catch (error) {
      console.error('Fetch data error:', error);
      toast.error('Failed to load job posting');
    } finally {
      setFormLoading(false);
    }
  };

  const updateField = (field, value) => {
    if (field.includes('.')) {
      const [parent, child] = field.split('.');
      setFormData((prev) => ({ ...prev, [parent]: { ...prev[parent], [child]: value } }));
    } else {
      setFormData((prev) => ({ ...prev, [field]: value }));
    }
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

  const handleSubmit = async (publish = false) => {
    if (!formData.jobTitle.trim()) { toast.error('Job title is required'); return; }
    if (!formData.department) { toast.error('Department is required'); return; }
    if (!formData.jobDescription.trim()) { toast.error('Job description is required'); return; }

    setLoading(true);
    try {
      const token = localStorage.getItem('token');
      const payload = {
        ...formData,
        status: publish ? 'open' : formData.status,
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

      const response = await fetch(`/api/recruitment/${params.id}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (data.success) {
        toast.success(publish ? 'Job published successfully' : 'Job updated successfully');
        router.push(`/dashboard/recruitment/${params.id}`);
      } else {
        toast.error(data.message || 'Failed to update job posting');
      }
    } catch (error) {
      console.error('Update job error:', error);
      toast.error('Failed to update job posting');
    } finally {
      setLoading(false);
    }
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
            <Button isIconOnly variant="light" size="sm" onPress={() => router.push(`/dashboard/recruitment/${params.id}`)}>
              <FaArrowLeft className="w-4 h-4" />
            </Button>
            <h1 className="text-2xl sm:text-3xl font-bold text-default-800">Edit Job Posting</h1>
          </div>
          <div className="flex gap-2 ml-10 md:ml-0">
            <Button variant="flat" onPress={() => handleSubmit(false)} isLoading={loading} startContent={<FaSave className="w-3.5 h-3.5" />}>
              Save Changes
            </Button>
            {formData.status === 'draft' && (
              <Button color="primary" onPress={() => handleSubmit(true)} isLoading={loading}>
                Publish Job
              </Button>
            )}
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
              <Select label="Status" size="sm"
                selectedKeys={[formData.status]}
                onSelectionChange={(keys) => updateField('status', Array.from(keys)[0])}>
                <SelectItem key="draft">Draft</SelectItem>
                <SelectItem key="open">Open</SelectItem>
                <SelectItem key="paused">Paused</SelectItem>
                <SelectItem key="closed">Closed</SelectItem>
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
          <CardHeader className="border-b border-default-200 px-4 sm:px-5 py-3">
            <h2 className="text-base font-semibold text-default-800">Job Description</h2>
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
                  <Chip key={i} onClose={() => removeArrayItem('skills', formData.skills.indexOf(skill))} variant="flat" color="primary">{skill}</Chip>
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
          <Button variant="flat" onPress={() => router.push(`/dashboard/recruitment/${params.id}`)}>Cancel</Button>
          <Button variant="flat" onPress={() => handleSubmit(false)} isLoading={loading} startContent={<FaSave className="w-3.5 h-3.5" />}>
            Save Changes
          </Button>
          {formData.status === 'draft' && (
            <Button color="primary" onPress={() => handleSubmit(true)} isLoading={loading}>
              Publish Job
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
