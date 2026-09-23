import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'

import { PublicHome } from './route-views'

describe('public Telegram community flow', () => {
  it('explains the project game journey and links directly to adding Rallyo Bot', () => {
    const markup = renderToStaticMarkup(
      <MemoryRouter>
        <PublicHome />
      </MemoryRouter>,
    )
    expect(markup).toContain('Play project games in Telegram.')
    expect(markup).toContain('Add Rallyo Bot')
    expect(markup).toContain('https://t.me/Rallyo_gamebot?startgroup=true')
    expect(markup).toContain('Approved questions about your project.')
    expect(markup).toContain('Connect Nimiq before claiming')
  })
})
