'use client'

import { useState, useEffect } from 'react'
import { getRoleDisplayLabel } from '@/hooks/useRoles'

export default function TaskDebugPage() {
  const [user, setUser] = useState(null)
  const [result, setResult] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const userData = localStorage.getItem('user')
    if (userData) {
      setUser(JSON.parse(userData))
    }
  }, [])

  const testTaskCreation = async () => {
    if (!user) {
      setResult('Please login first')
      return
    }

    setLoading(true)
    setResult('Testing task creation...\n')

    try {
      const token = localStorage.getItem('token')

      const taskData = {
        title: 'Debug Test Task',
        description: 'This is a debug test task',
        priority: 'medium',
        category: 'other',
        dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        estimatedHours: 2,
        assignedBy: user.userId,
        assignedTo: [{
          employee: user.userId,
          role: 'owner'
        }]
      }

      setResult(prev => prev + `Task data: ${JSON.stringify(taskData, null, 2)}\n\n`)

      const response = await fetch('/api/tasks', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          'Cache-Control': 'no-cache'
        },
        body: JSON.stringify(taskData)
      })

      const responseData = await response.json()

      setResult(prev => prev + `Response status: ${response.status}\n`)
      setResult(prev => prev + `Response data: ${JSON.stringify(responseData, null, 2)}\n\n`)

      if (responseData.success) {
        // Test fetching tasks
        setResult(prev => prev + 'Testing task fetch...\n')

        const fetchResponse = await fetch('/api/tasks?view=personal&limit=10', {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Cache-Control': 'no-cache'
          }
        })

        const fetchData = await fetchResponse.json()
        setResult(prev => prev + `Fetch response: ${JSON.stringify(fetchData, null, 2)}\n`)
      }

    } catch (error) {
      setResult(prev => prev + `Error: ${error.message}\n`)
    } finally {
      setLoading(false)
    }
  }

  const testTaskFetch = async () => {
    if (!user) {
      setResult('Please login first')
      return
    }

    setLoading(true)
    setResult('Testing task fetch...\n')

    try {
      const token = localStorage.getItem('token')

      const response = await fetch('/api/tasks?view=personal&limit=10', {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Cache-Control': 'no-cache'
        }
      })

      const data = await response.json()

      setResult(prev => prev + `Response status: ${response.status}\n`)
      setResult(prev => prev + `Response data: ${JSON.stringify(data, null, 2)}\n`)

    } catch (error) {
      setResult(prev => prev + `Error: ${error.message}\n`)
    } finally {
      setLoading(false)
    }
  }

  const testDatabase = async () => {
    if (!user) {
      setResult('Please login first')
      return
    }

    setLoading(true)
    setResult('Testing database connection...\n')

    try {
      const token = localStorage.getItem('token')

      const response = await fetch('/api/debug/db', {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Cache-Control': 'no-cache'
        }
      })

      const data = await response.json()

      setResult(prev => prev + `Response status: ${response.status}\n`)
      setResult(prev => prev + `Database info: ${JSON.stringify(data, null, 2)}\n`)

    } catch (error) {
      setResult(prev => prev + `Error: ${error.message}\n`)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-6">Task API Debug</h1>

      {user ? (
        <div className="mb-4 p-4 bg-green-50 rounded">
          <p>Logged in as: {user.firstName} {user.lastName} ({getRoleDisplayLabel(user.role)})</p>
          <p>User ID: {user.userId}</p>
        </div>
      ) : (
        <div className="mb-4 p-4 bg-red-50 rounded">
          <p>Not logged in</p>
        </div>
      )}

      <div className="space-x-4 mb-6">
        <button
          onClick={testTaskCreation}
          disabled={loading}
          className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600 disabled:opacity-50"
        >
          {loading ? 'Testing...' : 'Test Task Creation'}
        </button>

        <button
          onClick={testTaskFetch}
          disabled={loading}
          className="bg-green-500 text-white px-4 py-2 rounded hover:bg-green-600 disabled:opacity-50"
        >
          {loading ? 'Testing...' : 'Test Task Fetch'}
        </button>

        <button
          onClick={testDatabase}
          disabled={loading}
          className="bg-purple-500 text-white px-4 py-2 rounded hover:bg-purple-600 disabled:opacity-50"
        >
          {loading ? 'Testing...' : 'Test Database'}
        </button>

        <button
          onClick={() => setResult('')}
          className="bg-gray-500 text-white px-4 py-2 rounded hover:bg-gray-600"
        >
          Clear
        </button>
      </div>

      <div className="bg-gray-100 p-4 rounded">
        <h3 className="font-bold mb-2">Results:</h3>
        <pre className="whitespace-pre-wrap text-sm">{result}</pre>
      </div>
    </div>
  )
}
