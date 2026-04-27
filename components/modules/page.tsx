'use client'
import { useState, FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { useApp } from '@/lib/store'
import { Field, Input } from '@/components/ui'

export default function ForcePasswordChangePage() {
  const router = useRouter()
  const { currentUser, updateUser, showToast } = useApp()
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [pending, setPending] = useState(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!newPassword || newPassword !== confirmPassword) {
      showToast('Passwords do not match or are empty.', 'error')
      return
    }
    if (newPassword.length < 6) {
      showToast('Password must be at least 6 characters.', 'error')
      return
    }
    if (!currentUser) {
      showToast('User not found. Please log in again.', 'error')
      return
    }

    setPending(true)
    try {
      await updateUser(currentUser.id, {
        password: newPassword,
        mustChangePassword: false,
      })
      showToast('Password updated successfully. Redirecting...', 'success')
      router.replace('/')
    } catch (err) {
      showToast('Failed to update password. Please try again.', 'error')
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 p-4">
      <div className="w-full max-w-md">
        <div className="bg-white p-8 rounded-2xl shadow-lg border border-gray-100">
          <h2 className="text-xl font-bold text-gray-800 mb-2">Change Your Password</h2>
          <p className="text-sm text-gray-500 mb-6">
            For security, you must change the temporary password provided to you.
          </p>
          <form onSubmit={handleSubmit} className="space-y-4">
            <Field label="New Password" required hint="Minimum 6 characters">
              <Input type="password" value={newPassword} onChange={setNewPassword} autoFocus />
            </Field>
            <Field label="Confirm New Password" required>
              <Input type="password" value={confirmPassword} onChange={setConfirmPassword} />
            </Field>
            <button type="submit" disabled={pending} className="w-full btn-primary py-3 text-sm font-semibold">
              {pending ? 'Saving...' : 'Set New Password and Continue'}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}