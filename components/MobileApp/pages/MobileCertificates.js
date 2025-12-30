'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import MobileLayout from '../components/MobileLayout';
import '@/components/MobileApp/styles/mobile.css';

/**
 * Mobile Certificates Page
 * Certificate gallery with detail view
 */
export default function MobileCertificates({ 
  user, 
  certificates = []
}) {
  const router = useRouter();
  const [selectedCert, setSelectedCert] = useState(null);
  const [filterType, setFilterType] = useState('all');

  // Get unique certificate types
  const certTypes = ['all', ...new Set(certificates.map(c => c.type || c.category).filter(Boolean))];

  // Filter certificates
  const filteredCerts = filterType === 'all' 
    ? certificates 
    : certificates.filter(c => (c.type || c.category)?.toLowerCase() === filterType.toLowerCase());

  // Get certificate icon by type
  const getCertIcon = (type) => {
    switch(type?.toLowerCase()) {
      case 'professional': return 'workspace_premium';
      case 'training': return 'school';
      case 'compliance': return 'verified_user';
      case 'achievement': return 'emoji_events';
      case 'skill': return 'psychology';
      default: return 'card_membership';
    }
  };

  // Get certificate color by type
  const getCertColor = (type) => {
    switch(type?.toLowerCase()) {
      case 'professional': return 'blue';
      case 'training': return 'indigo';
      case 'compliance': return 'green';
      case 'achievement': return 'amber';
      case 'skill': return 'purple';
      default: return 'gray';
    }
  };

  // Format date
  const formatDate = (date) => {
    if (!date) return '';
    return new Date(date).toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric', 
      year: 'numeric' 
    });
  };

  // Check if certificate is expiring soon (within 30 days)
  const isExpiringSoon = (expiryDate) => {
    if (!expiryDate) return false;
    const expiry = new Date(expiryDate);
    const now = new Date();
    const daysUntilExpiry = Math.ceil((expiry - now) / (1000 * 60 * 60 * 24));
    return daysUntilExpiry > 0 && daysUntilExpiry <= 30;
  };

  // Check if certificate is expired
  const isExpired = (expiryDate) => {
    if (!expiryDate) return false;
    return new Date(expiryDate) < new Date();
  };

  // Certificate Detail View
  if (selectedCert) {
    return (
      <MobileLayout title="Certificate" user={user} showBack onBack={() => setSelectedCert(null)}>
        <div className="mobile-page">
          {/* Certificate Card */}
          <div 
            className="mobile-card"
            style={{ 
              background: `linear-gradient(135deg, var(--mobile-${getCertColor(selectedCert.type)}-500), var(--mobile-${getCertColor(selectedCert.type)}-600))`,
              color: 'white',
              padding: '32px 24px',
              borderRadius: '24px',
              textAlign: 'center',
              marginBottom: '24px',
              position: 'relative',
              overflow: 'hidden'
            }}
          >
            {/* Decorative elements */}
            <div style={{
              position: 'absolute',
              top: '-20px',
              right: '-20px',
              width: '100px',
              height: '100px',
              borderRadius: '50%',
              background: 'rgba(255,255,255,0.1)'
            }} />
            <div style={{
              position: 'absolute',
              bottom: '-30px',
              left: '-30px',
              width: '80px',
              height: '80px',
              borderRadius: '50%',
              background: 'rgba(255,255,255,0.1)'
            }} />
            
            <div style={{
              width: '80px',
              height: '80px',
              borderRadius: '20px',
              background: 'rgba(255,255,255,0.2)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 20px'
            }}>
              <span className="material-icons-round" style={{ fontSize: '40px' }}>{getCertIcon(selectedCert.type)}</span>
            </div>
            
            <h2 style={{ fontSize: '24px', fontWeight: 800, marginBottom: '8px' }}>
              {selectedCert.title || selectedCert.name}
            </h2>
            <p style={{ fontSize: '14px', fontWeight: 500, opacity: 0.9 }}>
              {selectedCert.issuer || selectedCert.issuedBy || 'Unknown Issuer'}
            </p>
          </div>

          {/* Certificate Details */}
          <div className="mobile-card mobile-card-soft" style={{ padding: '24px', borderRadius: '20px', marginBottom: '16px' }}>
            <h3 style={{ fontSize: '12px', fontWeight: 800, color: 'var(--mobile-gray-400)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '16px' }}>
              Certificate Details
            </h3>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '14px', fontWeight: 500, color: 'var(--mobile-gray-500)' }}>Certificate ID</span>
                <span style={{ fontSize: '14px', fontWeight: 700, color: 'var(--mobile-gray-900)' }}>
                  {selectedCert.certificateId || selectedCert._id?.slice(-8)}
                </span>
              </div>
              
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '14px', fontWeight: 500, color: 'var(--mobile-gray-500)' }}>Issue Date</span>
                <span style={{ fontSize: '14px', fontWeight: 700, color: 'var(--mobile-gray-900)' }}>
                  {formatDate(selectedCert.issueDate || selectedCert.issuedAt)}
                </span>
              </div>
              
              {selectedCert.expiryDate && (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '14px', fontWeight: 500, color: 'var(--mobile-gray-500)' }}>Expiry Date</span>
                  <span style={{ 
                    fontSize: '14px', 
                    fontWeight: 700, 
                    color: isExpired(selectedCert.expiryDate) 
                      ? 'var(--mobile-red-500)' 
                      : isExpiringSoon(selectedCert.expiryDate) 
                        ? 'var(--mobile-orange-500)' 
                        : 'var(--mobile-gray-900)'
                  }}>
                    {formatDate(selectedCert.expiryDate)}
                    {isExpired(selectedCert.expiryDate) && ' (Expired)'}
                    {isExpiringSoon(selectedCert.expiryDate) && ' (Expiring Soon)'}
                  </span>
                </div>
              )}
              
              {selectedCert.type && (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '14px', fontWeight: 500, color: 'var(--mobile-gray-500)' }}>Type</span>
                  <span className={`mobile-badge mobile-badge-${getCertColor(selectedCert.type)}`}>
                    {selectedCert.type}
                  </span>
                </div>
              )}
              
              {selectedCert.credentialUrl && (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '14px', fontWeight: 500, color: 'var(--mobile-gray-500)' }}>Credential URL</span>
                  <a 
                    href={selectedCert.credentialUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ fontSize: '14px', fontWeight: 700, color: 'var(--mobile-primary)', textDecoration: 'none' }}
                  >
                    View
                  </a>
                </div>
              )}
            </div>
          </div>

          {/* Description */}
          {selectedCert.description && (
            <div className="mobile-card mobile-card-soft" style={{ padding: '24px', borderRadius: '20px', marginBottom: '16px' }}>
              <h3 style={{ fontSize: '12px', fontWeight: 800, color: 'var(--mobile-gray-400)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '12px' }}>
                Description
              </h3>
              <p style={{ fontSize: '14px', fontWeight: 500, color: 'var(--mobile-gray-600)', lineHeight: 1.6 }}>
                {selectedCert.description}
              </p>
            </div>
          )}

          {/* Actions */}
          <div style={{ display: 'flex', gap: '12px' }}>
            {selectedCert.fileUrl && (
              <button 
                className="mobile-btn mobile-btn-primary mobile-btn-rounded"
                style={{ flex: 1, padding: '16px' }}
                onClick={() => window.open(selectedCert.fileUrl, '_blank')}
              >
                <span className="material-icons-round" style={{ fontSize: '20px' }}>download</span>
                Download
              </button>
            )}
            <button 
              className="mobile-btn mobile-btn-outline mobile-btn-rounded"
              style={{ flex: 1, padding: '16px' }}
              onClick={() => {/* Share logic */}}
            >
              <span className="material-icons-round" style={{ fontSize: '20px' }}>share</span>
              Share
            </button>
          </div>
        </div>
      </MobileLayout>
    );
  }

  // Certificate List View
  return (
    <MobileLayout title="Certificates" user={user}>
      <div className="mobile-page">
        {/* Page Header */}
        <div className="mobile-mb-6">
          <h2 style={{ fontSize: '24px', fontWeight: 700, marginBottom: '4px', color: 'var(--mobile-gray-900)' }}>
            Certificates
          </h2>
          <p style={{ color: 'var(--mobile-gray-400)', fontSize: '14px', fontWeight: 500 }}>
            Your achievements and qualifications
          </p>
        </div>

        {/* Stats Overview */}
        <div 
          className="mobile-card"
          style={{ 
            background: 'linear-gradient(135deg, var(--mobile-amber-400), var(--mobile-orange-500))',
            color: 'white',
            padding: '24px',
            borderRadius: '24px',
            marginBottom: '24px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between'
          }}
        >
          <div>
            <p style={{ fontSize: '12px', fontWeight: 600, opacity: 0.9, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
              Total Certificates
            </p>
            <p style={{ fontSize: '48px', fontWeight: 900, marginTop: '4px' }}>
              {certificates.length}
            </p>
          </div>
          <div style={{
            width: '70px',
            height: '70px',
            borderRadius: '18px',
            background: 'rgba(255,255,255,0.2)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}>
            <span className="material-icons-round" style={{ fontSize: '36px' }}>emoji_events</span>
          </div>
        </div>

        {/* Filter Tabs */}
        {certTypes.length > 1 && (
          <div className="mobile-tabs mobile-mb-6">
            {certTypes.map(type => (
              <button 
                key={type}
                className={`mobile-tab ${filterType === type ? 'mobile-tab-active' : ''}`}
                onClick={() => setFilterType(type)}
                style={{ textTransform: 'capitalize' }}
              >
                {type}
              </button>
            ))}
          </div>
        )}

        {/* Certificate Grid */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {filteredCerts.map((cert, idx) => (
            <div 
              key={cert._id || idx}
              className="mobile-card mobile-card-soft"
              style={{ 
                padding: '20px',
                borderRadius: '20px',
                cursor: 'pointer',
                position: 'relative',
                overflow: 'hidden'
              }}
              onClick={() => setSelectedCert(cert)}
            >
              {/* Expiry Warning */}
              {(isExpired(cert.expiryDate) || isExpiringSoon(cert.expiryDate)) && (
                <div style={{
                  position: 'absolute',
                  top: '12px',
                  right: '12px',
                  background: isExpired(cert.expiryDate) ? 'var(--mobile-red-500)' : 'var(--mobile-orange-500)',
                  color: 'white',
                  padding: '4px 8px',
                  borderRadius: '8px',
                  fontSize: '10px',
                  fontWeight: 700,
                  textTransform: 'uppercase'
                }}>
                  {isExpired(cert.expiryDate) ? 'Expired' : 'Expiring'}
                </div>
              )}
              
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '16px' }}>
                <div style={{
                  width: '52px',
                  height: '52px',
                  borderRadius: '14px',
                  background: `var(--mobile-${getCertColor(cert.type)}-50)`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: `var(--mobile-${getCertColor(cert.type)}-500)`,
                  flexShrink: 0
                }}>
                  <span className="material-icons-round" style={{ fontSize: '26px' }}>{getCertIcon(cert.type)}</span>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <h3 style={{ fontSize: '16px', fontWeight: 700, color: 'var(--mobile-gray-900)', marginBottom: '4px' }}>
                    {cert.title || cert.name}
                  </h3>
                  <p style={{ fontSize: '13px', fontWeight: 500, color: 'var(--mobile-gray-500)', marginBottom: '8px' }}>
                    {cert.issuer || cert.issuedBy}
                  </p>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '12px', fontWeight: 500, color: 'var(--mobile-gray-400)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <span className="material-icons-round" style={{ fontSize: '14px' }}>event</span>
                      {formatDate(cert.issueDate || cert.issuedAt)}
                    </span>
                    {cert.type && (
                      <span className={`mobile-badge mobile-badge-${getCertColor(cert.type)}`} style={{ fontSize: '10px', padding: '2px 8px' }}>
                        {cert.type}
                      </span>
                    )}
                  </div>
                </div>
                <span className="material-icons-round" style={{ color: 'var(--mobile-gray-300)', marginTop: '12px' }}>chevron_right</span>
              </div>
            </div>
          ))}
        </div>

        {/* Empty State */}
        {filteredCerts.length === 0 && (
          <div className="mobile-empty">
            <div className="mobile-empty-icon">
              <span className="material-icons-outlined">workspace_premium</span>
            </div>
            <h4 className="mobile-empty-title">
              {filterType === 'all' ? 'No certificates yet' : `No ${filterType} certificates`}
            </h4>
            <p className="mobile-empty-text">
              Complete trainings to earn certificates
            </p>
          </div>
        )}
      </div>
    </MobileLayout>
  );
}
