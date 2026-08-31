import { fireEvent, render, screen } from '@testing-library/react'
import MemberAvatar from '@/components/chat/MemberAvatar'

describe('MemberAvatar', () => {
  test('falls back to initials when a profile image cannot load', () => {
    render(
      <MemberAvatar
        member={{ firstName: 'Kushagra', lastName: 'Pandey', profilePicture: '/missing-avatar.jpg' }}
      />
    )

    fireEvent.error(screen.getByRole('img', { name: 'Kushagra Pandey profile' }))

    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(screen.getByText('KP')).toBeInTheDocument()
  })

  test('tries the image again when its URL changes', () => {
    const { rerender } = render(
      <MemberAvatar
        member={{ firstName: 'Aviraj', lastName: 'Sharma', profilePicture: '/old-avatar.jpg' }}
      />
    )

    fireEvent.error(screen.getByRole('img'))

    rerender(
      <MemberAvatar
        member={{ firstName: 'Aviraj', lastName: 'Sharma', profilePicture: '/new-avatar.jpg' }}
      />
    )

    expect(screen.getByRole('img')).toHaveAttribute('src', '/new-avatar.jpg')
  })
})
