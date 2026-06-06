import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { OpenVault } from './OpenVault'

describe('OpenVault', () => {
  it('hands the chosen folder to onPick', async () => {
    const pickFolder = vi.fn().mockResolvedValue('/vaults/a')
    const onPick = vi.fn()
    render(<OpenVault pickFolder={pickFolder} onPick={onPick} />)

    await userEvent.click(screen.getByRole('button', { name: /open vault folder/i }))

    expect(pickFolder).toHaveBeenCalledOnce()
    await waitFor(() => expect(onPick).toHaveBeenCalledWith('/vaults/a'))
  })

  it('does not call onPick when the picker is cancelled', async () => {
    const pickFolder = vi.fn().mockResolvedValue(null)
    const onPick = vi.fn()
    render(<OpenVault pickFolder={pickFolder} onPick={onPick} />)

    await userEvent.click(screen.getByRole('button', { name: /open vault folder/i }))

    expect(pickFolder).toHaveBeenCalledOnce()
    expect(onPick).not.toHaveBeenCalled()
  })

  it('is disabled while loading', () => {
    render(<OpenVault pickFolder={vi.fn()} onPick={vi.fn()} loading />)
    expect(screen.getByRole('button', { name: /open vault folder/i })).toBeDisabled()
  })
})
