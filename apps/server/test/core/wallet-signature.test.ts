import { createHash } from 'node:crypto'

import { BufferUtils, KeyPair } from '@nimiq/core'
import { describe, expect, it } from 'vitest'

import {
  inspectNimiqWalletSignature,
  nimiqHubSignedMessageHash,
  verifyNimiqWalletSignature,
} from '../../src/core/wallet-link-service'

const UTF8_MESSAGE = 'Rallyo café 🚀'
const UTF8_HUB_DIGEST = 'ad0517460bf7e1914aa652a9498c6b548cbe679d81e749df4a2fabad8e52a86b'

describe('Nimiq wallet signature interoperability', () => {
  it('matches the official Hub signed-message UTF-8 test vector', () => {
    expect(Buffer.from(nimiqHubSignedMessageHash(UTF8_MESSAGE)).toString('hex')).toBe(
      UTF8_HUB_DIGEST,
    )
  })

  it('verifies an ordinary Hub account signature over the official digest', () => {
    const keyPair = KeyPair.generate()
    const address = keyPair.toAddress().toUserFriendlyAddress()
    const signature = keyPair.sign(Buffer.from(UTF8_HUB_DIGEST, 'hex'))

    expect(
      verifyNimiqWalletSignature({
        message: UTF8_MESSAGE,
        messageHash: sha256(UTF8_MESSAGE),
        publicKeyHex: keyPair.publicKey.toHex(),
        signatureHex: signature.toHex(),
        signerAddress: address,
        expectedAddress: address,
        format: 'hub',
      }),
    ).toBe(true)
  })

  it('rejects a Hub signer or public key address mismatch', () => {
    const signer = KeyPair.generate()
    const other = KeyPair.generate()
    const address = signer.toAddress().toUserFriendlyAddress()
    const signature = signer.sign(nimiqHubSignedMessageHash(UTF8_MESSAGE))

    expect(
      verifyNimiqWalletSignature({
        message: UTF8_MESSAGE,
        messageHash: sha256(UTF8_MESSAGE),
        publicKeyHex: signer.publicKey.toHex(),
        signatureHex: signature.toHex(),
        signerAddress: other.toAddress().toUserFriendlyAddress(),
        expectedAddress: address,
        format: 'hub',
      }),
    ).toBe(false)
    expect(
      verifyNimiqWalletSignature({
        message: UTF8_MESSAGE,
        messageHash: sha256(UTF8_MESSAGE),
        publicKeyHex: other.publicKey.toHex(),
        signatureHex: signature.toHex(),
        signerAddress: address,
        expectedAddress: address,
        format: 'hub',
      }),
    ).toBe(false)
  })

  it('rejects an incorrect signature and records the failed stage', () => {
    const keyPair = KeyPair.generate()
    const address = keyPair.toAddress().toUserFriendlyAddress()
    const signature = keyPair.sign(nimiqHubSignedMessageHash(UTF8_MESSAGE))
    const incorrectSignature = Buffer.from(signature.toHex(), 'hex')
    incorrectSignature[0] = (incorrectSignature[0] ?? 0) ^ 0xff

    const diagnostics = inspectNimiqWalletSignature({
      message: UTF8_MESSAGE,
      messageHash: sha256(UTF8_MESSAGE),
      publicKeyHex: keyPair.publicKey.toHex(),
      signatureHex: incorrectSignature.toString('hex'),
      signerAddress: address,
      expectedAddress: address,
      format: 'hub',
    })

    expect(diagnostics).toMatchObject({
      signatureFormat: 'hub',
      publicKeyByteLength: 32,
      signatureByteLength: 64,
      normalizedExpectedAddress: address,
      derivedPublicKeyAddress: address,
      submittedHubSignerAddress: address,
      messageHashMatch: true,
      cryptographicSignatureValid: false,
      valid: false,
    })
  })

  it('keeps the Mini App raw-message signature format working', () => {
    const keyPair = KeyPair.generate()
    const address = keyPair.toAddress().toUserFriendlyAddress()
    const signature = keyPair.sign(BufferUtils.fromUtf8(UTF8_MESSAGE))

    expect(
      verifyNimiqWalletSignature({
        message: UTF8_MESSAGE,
        messageHash: sha256(UTF8_MESSAGE),
        publicKeyHex: keyPair.publicKey.toHex(),
        signatureHex: signature.toHex(),
        expectedAddress: address,
        format: 'mini-app',
      }),
    ).toBe(true)
  })
})

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}
