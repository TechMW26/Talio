'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import MobileLayout from '../components/MobileLayout';
import '@/components/MobileApp/styles/mobile.css';

/**
 * Mobile Documents Page
 * Document management view optimized for mobile
 */
export default function MobileDocuments({ 
  user, 
  documents = [],
  categories = []
}) {
  const router = useRouter();

  // Default categories if none provided
  const defaultCategories = [
    { id: 'personal', name: 'Personal', icon: 'person', color: 'blue', count: 0 },
    { id: 'employment', name: 'Employment', icon: 'work', color: 'indigo', count: 0 },
    { id: 'tax', name: 'Tax', icon: 'receipt_long', color: 'teal', count: 0 },
    { id: 'other', name: 'Other', icon: 'folder_open', color: 'slate', count: 0 },
  ];

  // Merge with actual document counts
  const documentCategories = (categories.length > 0 ? categories : defaultCategories).map(cat => ({
    ...cat,
    count: documents.filter(d => d.category?.toLowerCase() === cat.id?.toLowerCase() || d.category?.toLowerCase() === cat.name?.toLowerCase()).length
  }));

  // Handle upload
  const handleUpload = () => {
    router.push('/dashboard/documents/upload');
  };

  // Get color variable
  const getColorVar = (color) => {
    return color || 'blue';
  };

  return (
    <MobileLayout title="Documents" user={user}>
      <div className="mobile-page">
        {/* Page Header */}
        <div className="mobile-mb-6">
          <h2 style={{ fontSize: '24px', fontWeight: 700, marginBottom: '4px', color: 'var(--mobile-gray-900)' }}>
            Documents
          </h2>
          <p style={{ color: 'var(--mobile-gray-400)', fontSize: '14px', fontWeight: 500 }}>
            Manage your documents and files
          </p>
        </div>

        {/* Upload Button */}
        <button 
          className="mobile-btn mobile-btn-primary mobile-btn-full mobile-btn-rounded mobile-mb-10"
          onClick={handleUpload}
          style={{ 
            padding: '20px 24px',
            fontSize: '12px',
            fontWeight: 900,
            textTransform: 'uppercase',
            letterSpacing: '0.15em'
          }}
        >
          <span className="material-icons-round" style={{ fontSize: '20px' }}>add</span>
          Upload Document
        </button>

        {/* Category Cards */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {documentCategories.map((cat, i) => (
            <div 
              key={cat.id || i}
              className="mobile-card mobile-card-soft"
              style={{ 
                padding: '24px',
                borderRadius: '24px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                cursor: 'pointer',
                transition: 'transform 0.2s'
              }}
              onClick={() => router.push(`/dashboard/documents?category=${cat.id || cat.name}`)}
            >
              <div>
                <p style={{ fontSize: '10px', fontWeight: 900, color: 'var(--mobile-gray-300)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '4px' }}>
                  Category
                </p>
                <h3 style={{ fontSize: '20px', fontWeight: 900, color: 'var(--mobile-gray-900)' }}>
                  {cat.name}
                </h3>
                <p style={{ fontSize: '30px', fontWeight: 900, color: 'var(--mobile-gray-900)', marginTop: '8px' }}>
                  {cat.count}
                </p>
              </div>
              <div style={{
                width: '56px',
                height: '56px',
                borderRadius: '16px',
                background: `var(--mobile-${getColorVar(cat.color)}-50)`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: `var(--mobile-${getColorVar(cat.color)}-500)`,
                boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
                transition: 'transform 0.2s'
              }}>
                <span className="material-icons-round" style={{ fontSize: '30px' }}>{cat.icon}</span>
              </div>
            </div>
          ))}
        </div>

        {/* Recent Documents Section */}
        {documents.length > 0 && (
          <>
            <div className="mobile-section-header" style={{ marginTop: '32px', marginBottom: '16px' }}>
              <h3 className="mobile-section-title">Recent Documents</h3>
              <button 
                className="mobile-section-link"
                onClick={() => router.push('/dashboard/documents/all')}
              >
                View All
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {documents.slice(0, 5).map((doc, idx) => (
                <div 
                  key={doc._id || idx}
                  className="mobile-card mobile-card-soft"
                  style={{ 
                    padding: '16px',
                    borderRadius: '16px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '16px',
                    cursor: 'pointer'
                  }}
                  onClick={() => router.push(`/dashboard/documents/${doc._id}`)}
                >
                  <div style={{
                    width: '48px',
                    height: '48px',
                    borderRadius: '12px',
                    background: 'var(--mobile-primary-50)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'var(--mobile-primary)'
                  }}>
                    <span className="material-icons-outlined" style={{ fontSize: '24px' }}>
                      {doc.type === 'pdf' ? 'picture_as_pdf' : 
                       doc.type === 'image' ? 'image' : 'description'}
                    </span>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <h4 style={{ fontSize: '14px', fontWeight: 700, color: 'var(--mobile-gray-900)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {doc.name || doc.title}
                    </h4>
                    <p style={{ fontSize: '12px', fontWeight: 500, color: 'var(--mobile-gray-400)', marginTop: '4px' }}>
                      {doc.category} • {doc.size ? `${(doc.size / 1024).toFixed(1)} KB` : 'Unknown size'}
                    </p>
                  </div>
                  <span className="material-icons-round" style={{ color: 'var(--mobile-gray-300)' }}>chevron_right</span>
                </div>
              ))}
            </div>
          </>
        )}

        {/* Empty State */}
        {documents.length === 0 && (
          <div className="mobile-empty" style={{ marginTop: '32px' }}>
            <div className="mobile-empty-icon">
              <span className="material-icons-outlined">folder_open</span>
            </div>
            <h4 className="mobile-empty-title">No documents yet</h4>
            <p className="mobile-empty-text">Upload your first document to get started</p>
          </div>
        )}
      </div>
    </MobileLayout>
  );
}
