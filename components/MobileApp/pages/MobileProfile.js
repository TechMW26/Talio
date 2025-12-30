'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import MobileLayout from '../components/MobileLayout';
import '@/components/MobileApp/styles/mobile.css';
import { formatDesignation, formatDepartments } from '@/lib/formatters';
import toast from '@/utils/toast';
import dynamic from 'next/dynamic';

// Dynamically import heavy components
const AadhaarVerificationSection = dynamic(
    () => import('@/components/AadhaarVerificationSection'),
    { ssr: false, loading: () => <div className="animate-pulse bg-gray-100 h-64 rounded-2xl"></div> }
);

const ActiveSessionsSection = dynamic(
    () => import('@/components/ActiveSessionsSection'),
    { ssr: false, loading: () => <div className="animate-pulse bg-gray-100 h-32 rounded-2xl"></div> }
);


// Dynamically import Lanyard with no SSR
const Lanyard = dynamic(() => import('@/src/component/Lanyard').catch((error) => {
    console.error('Failed to load Lanyard component:', error);
    return { default: () => <div className="w-full h-full bg-transparent" /> };
}), {
    ssr: false,
    loading: () => <div className="w-full h-full bg-transparent" />
});

/**
 * Mobile Profile Page
 * Full-featured profile view optimized for mobile
 * Includes: Profile editing, Aadhaar verification, Lanyard preview, Active sessions
 */
export default function MobileProfile({
    user: initialUser,
    employee: initialEmployee
}) {
    const router = useRouter();
    const searchParams = useSearchParams();
    const fileInputRef = useRef(null);

    // State
    const [user, setUser] = useState(initialUser);
    const [employee, setEmployee] = useState(initialEmployee);
    const [loading, setLoading] = useState(!initialEmployee);
    const [isEditing, setIsEditing] = useState(false);
    const [editedEmployee, setEditedEmployee] = useState(null);
    const [saving, setSaving] = useState(false);
    const [uploadingImage, setUploadingImage] = useState(false);
    const [activeTab, setActiveTab] = useState('profile');
    const [profileCompletionStatus, setProfileCompletionStatus] = useState(null);

    // Check for edit mode from URL params
    useEffect(() => {
        const editMode = searchParams.get('edit');
        if (editMode === 'true') {
            setIsEditing(true);
        }
    }, [searchParams]);

    // Fetch profile data if not provided
    useEffect(() => {
        if (!initialEmployee) {
            fetchProfile();
        }
        fetchProfileCompletionStatus();
    }, [initialEmployee]);

    const fetchProfileCompletionStatus = async () => {
        try {
            const token = localStorage.getItem('token');
            const response = await fetch('/api/profile/completion-status', {
                headers: { Authorization: `Bearer ${token}` }
            });
            const result = await response.json();
            if (result.success) {
                setProfileCompletionStatus(result.data);
            }
        } catch (error) {
            console.error('Error fetching profile completion status:', error);
        }
    };

    const fetchProfile = async () => {
        try {
            const token = localStorage.getItem('token');
            const response = await fetch('/api/profile', {
                headers: { Authorization: `Bearer ${token}` }
            });
            const result = await response.json();
            if (result.success) {
                setUser(result.data.user);
                setEmployee(result.data.employee);
                setEditedEmployee(result.data.employee);
            }
        } catch (error) {
            console.error('Error fetching profile:', error);
            const userData = localStorage.getItem('user');
            if (userData) {
                const parsedUser = JSON.parse(userData);
                setUser(parsedUser);
                if (parsedUser.employeeId && typeof parsedUser.employeeId === 'object') {
                    setEmployee(parsedUser.employeeId);
                    setEditedEmployee(parsedUser.employeeId);
                }
            }
        } finally {
            setLoading(false);
        }
    };

    // Handle profile picture change
    const handleImageSelect = async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;

        if (!file.type.startsWith('image/')) {
            toast.error('Please select an image file');
            return;
        }

        if (file.size > 5 * 1024 * 1024) {
            toast.error('Image must be less than 5MB');
            return;
        }

        setUploadingImage(true);

        try {
            const reader = new FileReader();
            reader.onloadend = async () => {
                const base64Image = reader.result;

                const token = localStorage.getItem('token');
                const response = await fetch('/api/profile/picture', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${token}`
                    },
                    body: JSON.stringify({ image: base64Image })
                });

                const result = await response.json();
                if (result.success) {
                    setEmployee(prev => ({ ...prev, profilePicture: result.data.profilePicture }));
                    toast.success('Profile picture updated!');
                } else {
                    toast.error(result.message || 'Failed to update picture');
                }
            };
            reader.readAsDataURL(file);
        } catch (error) {
            toast.error('Failed to upload image');
        } finally {
            setUploadingImage(false);
        }
    };

    // Handle edit save
    const handleSave = async () => {
        setSaving(true);
        try {
            const token = localStorage.getItem('token');
            const response = await fetch('/api/profile', {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`
                },
                body: JSON.stringify(editedEmployee)
            });

            const result = await response.json();
            if (result.success) {
                setEmployee(result.data);
                setEditedEmployee(result.data);
                setIsEditing(false);
                toast.success('Profile updated successfully!');

                const userData = localStorage.getItem('user');
                if (userData) {
                    const parsedUser = JSON.parse(userData);
                    parsedUser.firstName = result.data.firstName;
                    parsedUser.lastName = result.data.lastName;
                    parsedUser.phone = result.data.phone;
                    localStorage.setItem('user', JSON.stringify(parsedUser));
                }
            } else {
                toast.error(result.message || 'Failed to update profile');
            }
        } catch (error) {
            toast.error('Failed to update profile');
        } finally {
            setSaving(false);
        }
    };

    const getFullName = () => {
        if (employee?.firstName) {
            return `${employee.firstName} ${employee.lastName || ''}`.trim();
        }
        return user?.email?.split('@')[0] || 'User';
    };

    const tabs = [
        { id: 'profile', label: 'Profile', icon: 'person' },
        { id: 'lanyard', label: 'ID Card', icon: 'badge' },
        { id: 'verification', label: 'Aadhaar', icon: 'verified_user' },
        { id: 'sessions', label: 'Sessions', icon: 'devices' }
    ];

    if (loading) {
        return (
            <MobileLayout title="Profile" user={user}>
                <div className="mobile-page">
                    <div className="animate-pulse space-y-4">
                        <div className="h-32 bg-gray-200 rounded-2xl"></div>
                        <div className="h-48 bg-gray-200 rounded-2xl"></div>
                        <div className="h-32 bg-gray-200 rounded-2xl"></div>
                    </div>
                </div>
            </MobileLayout>
        );
    }

    return (
        <MobileLayout title="Profile" user={user}>
            <div className="mobile-page" style={{ paddingBottom: '140px' }}>
                {/* Profile Header Card */}
                <div className="mobile-gradient-card" style={{ marginBottom: '24px' }}>
                    <div style={{ position: 'relative', zIndex: 10, textAlign: 'center' }}>
                        {/* Profile Picture */}
                        <div style={{ position: 'relative', display: 'inline-block', marginBottom: '16px' }}>
                            <div
                                style={{
                                    width: '100px',
                                    height: '100px',
                                    borderRadius: '50%',
                                    background: 'rgba(255,255,255,0.2)',
                                    border: '3px solid rgba(255,255,255,0.4)',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    overflow: 'hidden'
                                }}
                            >
                                {employee?.profilePicture ? (
                                    <img
                                        src={employee.profilePicture}
                                        alt="Profile"
                                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                                    />
                                ) : (
                                    <span className="material-icons-round" style={{ fontSize: '48px', color: 'white' }}>person</span>
                                )}
                                {uploadingImage && (
                                    <div style={{
                                        position: 'absolute',
                                        inset: 0,
                                        background: 'rgba(0,0,0,0.5)',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        borderRadius: '50%'
                                    }}>
                                        <span className="material-icons-round animate-spin" style={{ color: 'white' }}>refresh</span>
                                    </div>
                                )}
                            </div>
                            <button
                                onClick={() => fileInputRef.current?.click()}
                                style={{
                                    position: 'absolute',
                                    bottom: '0',
                                    right: '0',
                                    width: '32px',
                                    height: '32px',
                                    borderRadius: '50%',
                                    background: 'white',
                                    border: 'none',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
                                    cursor: 'pointer'
                                }}
                            >
                                <span className="material-icons-round" style={{ fontSize: '18px', color: 'var(--mobile-primary)' }}>camera_alt</span>
                            </button>
                            <input
                                ref={fileInputRef}
                                type="file"
                                accept="image/*"
                                onChange={handleImageSelect}
                                style={{ display: 'none' }}
                            />
                        </div>

                        <h2 style={{ fontSize: '22px', fontWeight: 700, color: 'white', marginBottom: '4px' }}>
                            {getFullName()}
                        </h2>
                        <p style={{ color: 'rgba(191, 219, 254, 1)', fontSize: '14px', fontWeight: 500 }}>
                            {formatDesignation(employee?.designation, employee) || user?.role || 'Employee'}
                        </p>
                        <p style={{ color: 'rgba(191, 219, 254, 0.8)', fontSize: '12px', marginTop: '4px' }}>
                            {employee?.employeeCode || employee?.employeeId || ''}
                        </p>
                    </div>
                </div>

                {/* Tab Navigation */}
                <div style={{
                    display: 'flex',
                    gap: '8px',
                    marginBottom: '24px',
                    overflowX: 'auto',
                    paddingBottom: '4px',
                    WebkitOverflowScrolling: 'touch'
                }}>
                    {tabs.map(tab => (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id)}
                            style={{
                                flex: '0 0 auto',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '6px',
                                padding: '10px 16px',
                                borderRadius: '12px',
                                border: 'none',
                                background: activeTab === tab.id ? 'var(--mobile-primary)' : 'white',
                                color: activeTab === tab.id ? 'white' : 'var(--mobile-gray-600)',
                                fontSize: '13px',
                                fontWeight: 600,
                                whiteSpace: 'nowrap',
                                cursor: 'pointer',
                                boxShadow: activeTab === tab.id ? '0 4px 12px rgba(59, 130, 246, 0.3)' : '0 1px 3px rgba(0,0,0,0.08)'
                            }}
                        >
                            <span className="material-icons-outlined" style={{ fontSize: '18px' }}>{tab.icon}</span>
                            {tab.label}
                        </button>
                    ))}
                </div>

                {/* Profile Tab */}
                {activeTab === 'profile' && (
                    <div>
                        {/* Edit Toggle */}
                        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '16px' }}>
                            {isEditing ? (
                                <div style={{ display: 'flex', gap: '8px' }}>
                                    <button
                                        onClick={() => { setIsEditing(false); setEditedEmployee(employee); }}
                                        style={{
                                            padding: '8px 16px',
                                            borderRadius: '10px',
                                            border: '1px solid var(--mobile-gray-200)',
                                            background: 'white',
                                            color: 'var(--mobile-gray-600)',
                                            fontSize: '13px',
                                            fontWeight: 600,
                                            cursor: 'pointer'
                                        }}
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        onClick={handleSave}
                                        disabled={saving}
                                        style={{
                                            padding: '8px 16px',
                                            borderRadius: '10px',
                                            border: 'none',
                                            background: 'var(--mobile-primary)',
                                            color: 'white',
                                            fontSize: '13px',
                                            fontWeight: 600,
                                            cursor: saving ? 'not-allowed' : 'pointer',
                                            opacity: saving ? 0.7 : 1,
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '6px'
                                        }}
                                    >
                                        {saving && <span className="material-icons-round animate-spin" style={{ fontSize: '16px' }}>refresh</span>}
                                        Save
                                    </button>
                                </div>
                            ) : (
                                <button
                                    onClick={() => { setIsEditing(true); setEditedEmployee({ ...employee }); }}
                                    style={{
                                        padding: '8px 16px',
                                        borderRadius: '10px',
                                        border: 'none',
                                        background: 'var(--mobile-primary-50)',
                                        color: 'var(--mobile-primary)',
                                        fontSize: '13px',
                                        fontWeight: 600,
                                        cursor: 'pointer',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '6px'
                                    }}
                                >
                                    <span className="material-icons-outlined" style={{ fontSize: '16px' }}>edit</span>
                                    Edit Profile
                                </button>
                            )}
                        </div>

                        {/* Employment Details */}
                        <div className="mobile-card" style={{ borderRadius: '20px', padding: '20px', marginBottom: '16px' }}>
                            <h3 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '16px', color: 'var(--mobile-gray-900)' }}>
                                Employment Details
                            </h3>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                <ProfileField label="Employee ID" value={employee?.employeeCode || 'N/A'} />
                                <ProfileField label="Department" value={formatDepartments(employee) || 'N/A'} />
                                <ProfileField label="Designation" value={formatDesignation(employee?.designation, employee) || 'N/A'} />
                                <ProfileField label="Employment Type" value={employee?.employmentType || 'Full-time'} />
                                <ProfileField
                                    label="Reporting Manager"
                                    value={employee?.reportingManager?.firstName
                                        ? `${employee.reportingManager.firstName} ${employee.reportingManager.lastName || ''}`
                                        : 'N/A'
                                    }
                                />
                                <ProfileField label="Work Location" value={employee?.workLocation || 'N/A'} />
                                <ProfileField
                                    label="Date of Joining"
                                    value={employee?.dateOfJoining
                                        ? new Date(employee.dateOfJoining).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
                                        : 'N/A'
                                    }
                                />
                            </div>
                        </div>

                        {/* Personal Details */}
                        <div className="mobile-card" style={{ borderRadius: '20px', padding: '20px', marginBottom: '16px' }}>
                            <h3 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '16px', color: 'var(--mobile-gray-900)' }}>
                                Personal Details
                            </h3>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                {isEditing ? (
                                    <>
                                        <EditableField
                                            label="First Name"
                                            value={editedEmployee?.firstName || ''}
                                            onChange={v => setEditedEmployee(prev => ({ ...prev, firstName: v }))}
                                        />
                                        <EditableField
                                            label="Last Name"
                                            value={editedEmployee?.lastName || ''}
                                            onChange={v => setEditedEmployee(prev => ({ ...prev, lastName: v }))}
                                        />
                                        <EditableField
                                            label="Phone"
                                            value={editedEmployee?.phone || ''}
                                            onChange={v => setEditedEmployee(prev => ({ ...prev, phone: v }))}
                                            type="tel"
                                        />
                                        <EditableField
                                            label="Date of Birth"
                                            value={editedEmployee?.dateOfBirth ? editedEmployee.dateOfBirth.split('T')[0] : ''}
                                            onChange={v => setEditedEmployee(prev => ({ ...prev, dateOfBirth: v }))}
                                            type="date"
                                        />
                                        <div>
                                            <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--mobile-gray-500)', marginBottom: '6px' }}>
                                                Gender
                                            </label>
                                            <select
                                                value={editedEmployee?.gender || ''}
                                                onChange={e => setEditedEmployee(prev => ({ ...prev, gender: e.target.value }))}
                                                style={{
                                                    width: '100%',
                                                    padding: '12px',
                                                    borderRadius: '10px',
                                                    border: '1px solid var(--mobile-gray-200)',
                                                    fontSize: '14px',
                                                    background: 'white'
                                                }}
                                            >
                                                <option value="">Select Gender</option>
                                                <option value="male">Male</option>
                                                <option value="female">Female</option>
                                                <option value="other">Other</option>
                                            </select>
                                        </div>
                                        <EditableField
                                            label="Address"
                                            value={editedEmployee?.address || ''}
                                            onChange={v => setEditedEmployee(prev => ({ ...prev, address: v }))}
                                            multiline
                                        />
                                    </>
                                ) : (
                                    <>
                                        <ProfileField label="Email" value={user?.email || employee?.email || 'N/A'} />
                                        <ProfileField label="Phone" value={employee?.phone || 'N/A'} />
                                        <ProfileField
                                            label="Date of Birth"
                                            value={employee?.dateOfBirth
                                                ? new Date(employee.dateOfBirth).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
                                                : 'N/A'
                                            }
                                        />
                                        <ProfileField
                                            label="Gender"
                                            value={employee?.gender ? employee.gender.charAt(0).toUpperCase() + employee.gender.slice(1) : 'N/A'}
                                        />
                                        <ProfileField label="Blood Group" value={employee?.bloodGroup || 'N/A'} />
                                        <ProfileField label="Address" value={employee?.address || 'N/A'} />
                                    </>
                                )}
                            </div>
                        </div>

                        {/* Emergency Contact */}
                        <div className="mobile-card" style={{ borderRadius: '20px', padding: '20px' }}>
                            <h3 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '16px', color: 'var(--mobile-gray-900)' }}>
                                Emergency Contact
                            </h3>
                            {isEditing ? (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                    <EditableField
                                        label="Contact Name"
                                        value={editedEmployee?.emergencyContact?.name || ''}
                                        onChange={v => setEditedEmployee(prev => ({
                                            ...prev,
                                            emergencyContact: { ...prev?.emergencyContact, name: v }
                                        }))}
                                    />
                                    <EditableField
                                        label="Contact Phone"
                                        value={editedEmployee?.emergencyContact?.phone || ''}
                                        onChange={v => setEditedEmployee(prev => ({
                                            ...prev,
                                            emergencyContact: { ...prev?.emergencyContact, phone: v }
                                        }))}
                                        type="tel"
                                    />
                                    <EditableField
                                        label="Relationship"
                                        value={editedEmployee?.emergencyContact?.relationship || ''}
                                        onChange={v => setEditedEmployee(prev => ({
                                            ...prev,
                                            emergencyContact: { ...prev?.emergencyContact, relationship: v }
                                        }))}
                                    />
                                </div>
                            ) : (
                                <div style={{
                                    background: 'var(--mobile-red-50)',
                                    padding: '16px',
                                    borderRadius: '12px'
                                }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                        <div style={{
                                            width: '40px',
                                            height: '40px',
                                            borderRadius: '10px',
                                            background: 'var(--mobile-red-100)',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            color: 'var(--mobile-red-500)'
                                        }}>
                                            <span className="material-icons-outlined">contact_phone</span>
                                        </div>
                                        <div>
                                            <p style={{ fontSize: '15px', fontWeight: 600, color: 'var(--mobile-gray-900)' }}>
                                                {employee?.emergencyContact?.name || 'Not Provided'}
                                            </p>
                                            {employee?.emergencyContact?.phone && (
                                                <p style={{ fontSize: '13px', color: 'var(--mobile-gray-500)' }}>
                                                    {employee.emergencyContact.phone}
                                                </p>
                                            )}
                                            {employee?.emergencyContact?.relationship && (
                                                <p style={{ fontSize: '12px', color: 'var(--mobile-gray-400)', marginTop: '2px' }}>
                                                    {employee.emergencyContact.relationship}
                                                </p>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* Lanyard/ID Card Tab */}
                {activeTab === 'lanyard' && (
                    <div style={{ minHeight: '500px', position: 'relative' }}>
                        <div style={{
                            background: 'linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%)',
                            borderRadius: '20px',
                            padding: '16px',
                            minHeight: '500px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center'
                        }}>
                            {typeof window !== 'undefined' && (
                                <div style={{ width: '100%', height: '480px' }}>
                                    <Lanyard
                                        key={`lanyard-mobile-${employee?.company?._id || employee?.company || 'default'}`}
                                        employee={{
                                            name: employee ? `${employee.firstName} ${employee.lastName}` : undefined,
                                            designation: employee?.designation?.title || employee?.designation,
                                            employeeId: employee?.employeeCode,
                                            photo: employee?.profilePicture,
                                            phone: employee?.phone,
                                            bloodGroup: employee?.bloodGroup,
                                            email: employee?.email,
                                            address: employee?.address,
                                            dob: employee?.dateOfBirth,
                                            joiningDate: employee?.dateOfJoining,
                                        }}
                                        company={{
                                            name: employee?.company?.name,
                                            logo: employee?.company?.logo,
                                        }}
                                        showControls={false}
                                    />
                                </div>
                            )}
                        </div>
                        <p style={{
                            textAlign: 'center',
                            fontSize: '12px',
                            color: 'var(--mobile-gray-500)',
                            marginTop: '12px'
                        }}>
                            Drag to rotate • Your digital ID card
                        </p>
                    </div>
                )}

                {/* Aadhaar Verification Tab */}
                {activeTab === 'verification' && (
                    <div>
                        <AadhaarVerificationSection
                            initialStatus={profileCompletionStatus}
                            onStatusChange={(status) => {
                                setProfileCompletionStatus(prev => ({ ...prev, ...status }));
                            }}
                            onUseAadhaarData={(data) => {
                                if (data.name) {
                                    const nameParts = data.name.split(' ');
                                    setEditedEmployee(prev => ({
                                        ...prev,
                                        firstName: nameParts[0],
                                        lastName: nameParts.slice(1).join(' ')
                                    }));
                                }
                                if (data.dateOfBirth) {
                                    setEditedEmployee(prev => ({ ...prev, dateOfBirth: data.dateOfBirth }));
                                }
                                if (data.address) {
                                    setEditedEmployee(prev => ({ ...prev, address: data.address }));
                                }
                                setIsEditing(true);
                                setActiveTab('profile');
                                toast.info('Aadhaar data loaded. Review and save your profile.');
                            }}
                            showUrgentWarning={profileCompletionStatus?.status === 'incomplete'}
                        />
                    </div>
                )}

                {/* Active Sessions Tab */}
                {activeTab === 'sessions' && (
                    <div>
                        <ActiveSessionsSection />
                    </div>
                )}
            </div>
        </MobileLayout>
    );
}

// Profile Field Display Component
function ProfileField({ label, value }) {
    return (
        <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            padding: '8px 0',
            borderBottom: '1px solid var(--mobile-gray-50)'
        }}>
            <span style={{ fontSize: '13px', color: 'var(--mobile-gray-500)', fontWeight: 500 }}>
                {label}
            </span>
            <span style={{
                fontSize: '13px',
                color: 'var(--mobile-gray-900)',
                fontWeight: 600,
                textAlign: 'right',
                maxWidth: '60%',
                wordBreak: 'break-word'
            }}>
                {value}
            </span>
        </div>
    );
}

// Editable Field Component
function EditableField({ label, value, onChange, type = 'text', multiline = false }) {
    return (
        <div>
            <label style={{
                display: 'block',
                fontSize: '12px',
                fontWeight: 600,
                color: 'var(--mobile-gray-500)',
                marginBottom: '6px'
            }}>
                {label}
            </label>
            {multiline ? (
                <textarea
                    value={value}
                    onChange={e => onChange(e.target.value)}
                    rows={3}
                    style={{
                        width: '100%',
                        padding: '12px',
                        borderRadius: '10px',
                        border: '1px solid var(--mobile-gray-200)',
                        fontSize: '14px',
                        resize: 'none'
                    }}
                />
            ) : (
                <input
                    type={type}
                    value={value}
                    onChange={e => onChange(e.target.value)}
                    style={{
                        width: '100%',
                        padding: '12px',
                        borderRadius: '10px',
                        border: '1px solid var(--mobile-gray-200)',
                        fontSize: '14px'
                    }}
                />
            )}
        </div>
    );
}
