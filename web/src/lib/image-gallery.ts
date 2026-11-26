'use client';

import { useEffect } from 'react';

/** Uma imagem da conversa que dá para ampliar e percorrer com as setas. */
export type GalleryItem = { src: string; alt: string };

// A conversa aberta registra aqui as imagens dela (na ordem da tela); o visualizador lê ao abrir.
let registered: GalleryItem[] = [];

export function getGallery(): GalleryItem[] {
  return registered;
}

/** Registra as imagens da conversa enquanto ela está na tela. */
export function useRegisterGallery(items: GalleryItem[]) {
  useEffect(() => {
    registered = items;
    return () => {
      if (registered === items) registered = [];
    };
  }, [items]);
}
