'use client'

import { useState, useEffect } from 'react'
import { FaMapMarkerAlt, FaPlus, FaEdit, FaTrash, FaStar, FaRegStar, FaClock } from 'react-icons/fa'
import GeofenceMap from '@/components/GeofenceMap'
import Loader from '@/components/ui/Loader'

export default function GeofenceLocationsPage() {
  const [locations, setLocations] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editingLocation, setEditingLocation] = useState(null)
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    address: '',
    center: { latitude: 0, longitude: 0 },
    radius: 100,
    isActive: true,
    isPrimary: false,
    strictMode: false,
    breakTimings: []
  })

  useEffect(() => {
    fetchLocations()
  }, [])

  const fetchLocations = async () => {
    try {
      const token = localStorage.getItem('token')
      const response = await fetch('/api/geofence/locations', {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      const data = await response.json()
      if (data.success) {
        setLocations(data.data)
      }
    } catch (error) {
      console.error('Error fetching locations:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleOpenModal = (location = null) => {
    if (location) {
      setEditingLocation(location)
      setFormData({
        name: location.name || '',
        description: location.description || '',
        address: location.address || '',
        center: location.center || { latitude: 0, longitude: 0 },
        radius: location.radius || 100,
        isActive: location.isActive !== undefined ? location.isActive : true,
        isPrimary: location.isPrimary || false,
        strictMode: location.strictMode || false,
        breakTimings: location.breakTimings || []
      })
      setShowModal(true)
    } else {
      // For new location, try to get current location
      setEditingLocation(null)

      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          (position) => {
            setFormData({
              name: '',
              description: '',
              address: '',
              center: {
                latitude: position.coords.latitude,
                longitude: position.coords.longitude
              },
              radius: 100,
              isActive: true,
              isPrimary: false,
              strictMode: false,
              breakTimings: []
            })
            setShowModal(true)
          },
          (error) => {
            console.error('Error getting location:', error)
            // Fallback to a default location (New Delhi, India)
            setFormData({
              name: '',
              description: '',
              address: '',
              center: { latitude: 28.6139, longitude: 77.2090 },
              radius: 100,
              isActive: true,
              isPrimary: false,
              strictMode: false,
              breakTimings: []
            })
            setShowModal(true)
          }
        )
      } else {
        // Fallback to a default location (New Delhi, India)
        setFormData({
          name: '',
          description: '',
          address: '',
          center: { latitude: 28.6139, longitude: 77.2090 },
          radius: 100,
          isActive: true,
          isPrimary: false,
          strictMode: false,
          breakTimings: []
        })
        setShowModal(true)
      }
    }
  }

  const handleSave = async (e) => {
    e.preventDefault()

    try {
      const token = localStorage.getItem('token')
      const url = editingLocation
        ? `/api/geofence/locations/${editingLocation._id}`
        : '/api/geofence/locations'

      const method = editingLocation ? 'PUT' : 'POST'

      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(formData)
      })

      const data = await response.json()

      if (data.success) {
        setShowModal(false)
        fetchLocations()
      } else {
        alert(data.message || 'Failed to save location')
      }
    } catch (error) {
      console.error('Error saving location:', error)
      alert('Failed to save location')
    }
  }

  const handleDelete = async (locationId) => {
    if (!confirm('Are you sure you want to delete this location?')) return

    try {
      const token = localStorage.getItem('token')
      const response = await fetch(`/api/geofence/locations/${locationId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      })

      const data = await response.json()

      if (data.success) {
        fetchLocations()
      } else {
        alert(data.message || 'Failed to delete location')
      }
    } catch (error) {
      console.error('Error deleting location:', error)
      alert('Failed to delete location')
    }
  }

  const handleMapUpdate = (center, radius) => {
    setFormData(prev => ({
      ...prev,
      center: { latitude: center.lat, longitude: center.lng },
      radius
    }))
  }

  const addBreakTiming = () => {
    setFormData(prev => ({
      ...prev,
      breakTimings: [
        ...prev.breakTimings,
        {
          name: '',
          startTime: '13:00',
          endTime: '14:00',
          days: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
          isActive: true
        }
      ]
    }))
  }

  const updateBreakTiming = (index, field, value) => {
    setFormData(prev => ({
      ...prev,
      breakTimings: prev.breakTimings.map((bt, i) =>
        i === index ? { ...bt, [field]: value } : bt
      )
    }))
  }

  const removeBreakTiming = (index) => {
    setFormData(prev => ({
      ...prev,
      breakTimings: prev.breakTimings.filter((_, i) => i !== index)
    }))
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader size="lg" />
      </div>
    )
  }

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <FaMapMarkerAlt className="text-primary-500" />
            Geofence Locations
          </h1>
          <p className="text-gray-600 mt-1">Manage multiple office locations and geofence boundaries</p>
        </div>
        <button
          onClick={() => handleOpenModal()}
          className="flex items-center gap-2 px-4 py-2 bg-primary-500 text-white rounded-lg hover:bg-primary-600 transition-colors"
        >
          <FaPlus /> Add Location
        </button>
      </div>

      {/* Locations List */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {locations.map(location => (
          <div
            key={location._id}
            className={`bg-white rounded-lg border-2 p-4 ${location.isPrimary ? 'border-primary-500' : 'border-gray-200'
              }`}
          >
            <div className="flex justify-between items-start mb-3">
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <h3 className="text-lg font-semibold text-gray-900">{location.name}</h3>
                  {location.isPrimary && (
                    <FaStar className="text-yellow-500" title="Primary Location" />
                  )}
                </div>
                {location.description && (
                  <p className="text-sm text-gray-600 mt-1">{location.description}</p>
                )}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => handleOpenModal(location)}
                  className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                  title="Edit"
                >
                  <FaEdit />
                </button>
                {!location.isPrimary && (
                  <button
                    onClick={() => handleDelete(location._id)}
                    className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                    title="Delete"
                  >
                    <FaTrash />
                  </button>
                )}
              </div>
            </div>

            <div className="space-y-2 text-sm">
              {location.address && (
                <p className="text-gray-600">
                  <FaMapMarkerAlt className="inline mr-2 text-gray-400" />
                  {location.address}
                </p>
              )}
              <p className="text-gray-600">
                <span className="font-medium">Radius:</span> {location.radius}m
              </p>
              <p className="text-gray-600">
                <span className="font-medium">Coordinates:</span> {location.center.latitude.toFixed(6)}, {location.center.longitude.toFixed(6)}
              </p>
              {location.breakTimings && location.breakTimings.length > 0 && (
                <p className="text-gray-600">
                  <FaClock className="inline mr-2 text-gray-400" />
                  {location.breakTimings.length} break timing(s)
                </p>
              )}
              <div className="flex gap-2 mt-3">
                {location.strictMode && (
                  <span className="px-2 py-1 bg-red-100 text-red-700 text-xs rounded">Strict Mode</span>
                )}
                {location.isActive ? (
                  <span className="px-2 py-1 bg-green-100 text-green-700 text-xs rounded">Active</span>
                ) : (
                  <span className="px-2 py-1 bg-gray-100 text-gray-700 text-xs rounded">Inactive</span>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {locations.length === 0 && (
        <div className="text-center py-12 bg-gray-50 rounded-lg">
          <FaMapMarkerAlt className="mx-auto text-gray-400 text-5xl mb-4" />
          <p className="text-gray-600 text-lg">No geofence locations configured</p>
          <p className="text-gray-500 text-sm mt-2">Click "Add Location" to create your first geofence location</p>
        </div>
      )}

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 flex items-center justify-center z-[9100] p-4" style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}>
          <div className="bg-white rounded-lg max-w-4xl w-full max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex justify-between items-center">
              <h2 className="text-xl font-bold text-gray-900">
                {editingLocation ? 'Edit Location' : 'Add New Location'}
              </h2>
              <button
                onClick={() => setShowModal(false)}
                className="text-gray-500 hover:text-gray-700 text-2xl"
              >
                ×
              </button>
            </div>

            <form onSubmit={handleSave} className="p-6 space-y-6">
              {/* Basic Info */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">
                    Location Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                    placeholder="e.g., Main Office, Branch Office"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">
                    Address
                  </label>
                  <input
                    type="text"
                    value={formData.address}
                    onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                    placeholder="Full address"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  Description
                </label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                  rows="2"
                  placeholder="Optional description"
                />
              </div>

              {/* Map */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  Location & Radius
                </label>
                <div className="h-96 rounded-lg overflow-hidden border border-gray-300">
                  <GeofenceMap
                    center={{ lat: formData.center.latitude, lng: formData.center.longitude }}
                    radius={formData.radius}
                    onUpdate={handleMapUpdate}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">
                    Latitude
                  </label>
                  <input
                    type="number"
                    step="any"
                    value={formData.center.latitude}
                    onChange={(e) => setFormData({
                      ...formData,
                      center: { ...formData.center, latitude: parseFloat(e.target.value) }
                    })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">
                    Longitude
                  </label>
                  <input
                    type="number"
                    step="any"
                    value={formData.center.longitude}
                    onChange={(e) => setFormData({
                      ...formData,
                      center: { ...formData.center, longitude: parseFloat(e.target.value) }
                    })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">
                    Radius (meters)
                  </label>
                  <input
                    type="number"
                    min="10"
                    value={formData.radius}
                    onChange={(e) => setFormData({ ...formData, radius: parseInt(e.target.value) })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                  />
                </div>
              </div>

              {/* Settings */}
              <div className="space-y-3">
                <label className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={formData.isPrimary}
                    onChange={(e) => setFormData({ ...formData, isPrimary: e.target.checked })}
                    className="w-5 h-5 rounded text-primary-500 focus:ring-primary-500"
                  />
                  <span className="text-sm font-medium text-gray-700">Set as Primary Location</span>
                </label>
                <label className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={formData.strictMode}
                    onChange={(e) => setFormData({ ...formData, strictMode: e.target.checked })}
                    className="w-5 h-5 rounded text-primary-500 focus:ring-primary-500"
                  />
                  <span className="text-sm font-medium text-gray-700">Strict Mode (require check-in within geofence)</span>
                </label>
                <label className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={formData.isActive}
                    onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })}
                    className="w-5 h-5 rounded text-primary-500 focus:ring-primary-500"
                  />
                  <span className="text-sm font-medium text-gray-700">Active</span>
                </label>
              </div>

              {/* Break Timings */}
              <div>
                <div className="flex justify-between items-center mb-3">
                  <label className="text-sm font-semibold text-gray-700">Break Timings</label>
                  <button
                    type="button"
                    onClick={addBreakTiming}
                    className="text-sm text-primary-600 hover:text-primary-700 flex items-center gap-1"
                  >
                    <FaPlus /> Add Break
                  </button>
                </div>
                {formData.breakTimings.map((breakTiming, index) => (
                  <div key={index} className="bg-gray-50 p-4 rounded-lg mb-3">
                    <div className="flex justify-between items-start mb-3">
                      <input
                        type="text"
                        value={breakTiming.name}
                        onChange={(e) => updateBreakTiming(index, 'name', e.target.value)}
                        className="flex-1 px-3 py-2 border border-gray-300 rounded-lg mr-2"
                        placeholder="Break name (e.g., Lunch Break)"
                      />
                      <button
                        type="button"
                        onClick={() => removeBreakTiming(index)}
                        className="p-2 text-red-600 hover:bg-red-50 rounded-lg"
                      >
                        <FaTrash />
                      </button>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs text-gray-600 mb-1">Start Time</label>
                        <input
                          type="time"
                          value={breakTiming.startTime}
                          onChange={(e) => updateBreakTiming(index, 'startTime', e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-600 mb-1">End Time</label>
                        <input
                          type="time"
                          value={breakTiming.endTime}
                          onChange={(e) => updateBreakTiming(index, 'endTime', e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Actions */}
              <div className="flex justify-end gap-3 pt-4 border-t border-gray-200">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-6 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-6 py-2 bg-primary-500 text-white rounded-lg hover:bg-primary-600"
                >
                  {editingLocation ? 'Update' : 'Create'} Location
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

