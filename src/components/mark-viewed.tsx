"use client";

import { useEffect, useRef } from "react";

import { markChildViewedAction } from "@/lib/actions/family";

/**
 * Отметка «дневник ребёнка открыт» — вызывается ПОСЛЕ рендера страницы
 * /family/child/[studentId], а не при заходе на /family: иначе «новое»
 * гасло бы раньше, чем родитель его прочитал. Страницы-чтения в БД не
 * пишут — пишет это клиентское действие. Ошибка не показывается:
 * счётчик «нового» — удобство, а не данные.
 */
export function MarkViewed({ studentId }: { studentId: string }) {
  const sent = useRef(false);

  useEffect(() => {
    if (sent.current) return;
    sent.current = true;
    void markChildViewedAction({ studentId }).catch(() => {
      /* тихо: следующий визит отметится сам */
    });
  }, [studentId]);

  return null;
}
