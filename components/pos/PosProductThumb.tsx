'use client'

import { useState } from 'react'
import { Fa, faBox } from '@/components/icons'
import { productThumbSource, type ProductThumbInput } from '@/lib/product-images'

export function PosProductThumb({ product }: { product: ProductThumbInput }) {
  const source = productThumbSource(product)
  const [failed, setFailed] = useState(false)
  const [loaded, setLoaded] = useState(false)

  if (!source || failed) {
    return <Fa icon={faBox} />
  }

  const showPhoto = loaded || !source.speculative

  return (
    <>
      {!showPhoto ? <Fa icon={faBox} /> : null}
      <img
        src={source.src}
        alt=""
        hidden={!showPhoto}
        onLoad={() => setLoaded(true)}
        onError={() => setFailed(true)}
      />
    </>
  )
}
