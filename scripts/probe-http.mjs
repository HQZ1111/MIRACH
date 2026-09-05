import { readFileSync } from 'node:fs';
const src = readFileSync('G:/deepseek-harness-master/apps/mirach/src/components/chat/MemberChatPanel.tsx', 'utf8');
const lines = src.split(/\r?\n/);
lines.forEach((l, i) => {
  if (/Composer|onSend|standalone/.test(l)) console.log((i + 1) + ':', l.trim().slice(0, 110));
});
