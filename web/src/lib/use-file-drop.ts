'use client';

import { useEffect, useRef } from 'react';

/** O que está sendo arrastado traz arquivos (e não só texto ou um link)? */
const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');

/**
 * Soltar arquivos em qualquer lugar de uma área (a conversa inteira, não só o campo de mensagem).
 *
 * `getZone` devolve o elemento da área; enquanto algo com arquivos é arrastado sobre ele, ganha `data-dragging="true"`
 * (o aviso "Solte para anexar" está no globals.css, para elementos com `data-drop-zone`). Soltar chama `onFiles`.
 * Arrastar texto ou links não conta. `enabled=false` desliga (conversa em que não dá para responder).
 */
export function useFileDrop(getZone: () => HTMLElement | null | undefined, onFiles: (files: File[]) => void, enabled = true) {
  const onFilesRef = useRef(onFiles);
  const getZoneRef = useRef(getZone);
  useEffect(() => {
    onFilesRef.current = onFiles;
    getZoneRef.current = getZone;
  });

  useEffect(() => {
    const zone = enabled ? getZoneRef.current() : null;
    if (!zone) return;
    // dragenter/dragleave disparam também ao passar por elementos filhos: conta as entradas para só apagar o aviso ao sair de vez
    let depth = 0;
    const clear = () => {
      depth = 0;
      delete zone.dataset.dragging;
    };
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth += 1;
      zone.dataset.dragging = 'true';
    };
    const over = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    };
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) clear();
    };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      clear();
      const files = Array.from(e.dataTransfer?.files ?? []);
      if (files.length) onFilesRef.current(files);
    };
    zone.addEventListener('dragenter', enter);
    zone.addEventListener('dragover', over);
    zone.addEventListener('dragleave', leave);
    zone.addEventListener('drop', drop);
    // soltou fora da janela ou cancelou com Esc: apaga o aviso
    window.addEventListener('dragend', clear);
    window.addEventListener('drop', clear);
    return () => {
      zone.removeEventListener('dragenter', enter);
      zone.removeEventListener('dragover', over);
      zone.removeEventListener('dragleave', leave);
      zone.removeEventListener('drop', drop);
      window.removeEventListener('dragend', clear);
      window.removeEventListener('drop', clear);
      clear();
    };
  }, [enabled]);
}
