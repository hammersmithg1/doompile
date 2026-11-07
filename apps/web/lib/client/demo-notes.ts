import { createNote, type Note } from "@doompile/core";
function demoNotes(): Note[] {
  return [
    createNote({
      id: "11111111-1111-4111-8111-111111111111",
      title: "Забрать посылку",
      plainText: "До пятницы. В этот раз точно.",
      urgent: true,
      tags: ["Личное"],
    }),
    createNote({
      id: "22222222-2222-4222-8222-222222222222",
      title: "Меньше раскладывать. Больше замечать.",
      plainText:
        "Место для мыслей, которые приходят не вовремя. Для фрагментов, которые хочется перечитать. Для вещей, которые пока никуда не вписываются.",
      tags: ["Идеи"],
      pinned: true,
    }),
    createNote({
      id: "33333333-3333-4333-8333-333333333333",
      title: "Выделить. Прокомментировать. Сохранить.",
      kind: "article",
      plainText:
        "Вот такой должна быть работа с хорошей статьёй: сохранить мысль в контексте, пока не потерялась своя.",
      source: {
        url: "https://example.com/article",
        title: "Фрагмент из статьи",
        quote: "Your mind is for having ideas, not holding them.",
      },
      tags: ["Почитать", "Идеи"],
    }),
    createNote({
      id: "44444444-4444-4444-8444-444444444444",
      title: "На выходных",
      plainText:
        "Погулять без маршрута\nЗайти в книжный\nНачать тот самый проект",
      body: {
        type: "doc",
        content: [
          {
            type: "taskList",
            content: [
              "Погулять без маршрута",
              "Зайти в книжный",
              "Начать тот самый проект",
            ].map((text, i) => ({
              type: "taskItem",
              attrs: { checked: i === 0 },
              content: [
                { type: "paragraph", content: [{ type: "text", text }] },
              ],
            })),
          },
        ],
      },
      tags: ["Личное"],
    }),
  ];
}

let cachedDemo: Note[] | undefined;
export function demoNotesCached() {
  return (cachedDemo ??= demoNotes());
}
