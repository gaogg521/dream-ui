import React, { useEffect } from 'react';
import useSWR from 'swr';
import { ipcBridge } from '@/common';
import type { IMessagePlan } from '@/common/chat/chatLib';
import { TaskChecklist } from '@/renderer/pages/conversation/Messages/components/MessagePlan';

export default function TeamTaskChecklist({ teamId }: { teamId: string }) {
  const { data, mutate } = useSWR(['team-chat-tasks', teamId], () =>
    ipcBridge.team.listTasks.invoke({ team_id: teamId })
  );
  useEffect(() => {
    const unsubscribeTask = ipcBridge.team.taskChanged.on((event) => {
      if (event.team_id === teamId) void mutate();
    });
    const unsubscribeReconnect = ipcBridge.realtime.reconnected.on(() => void mutate());
    return () => {
      unsubscribeTask();
      unsubscribeReconnect();
    };
  }, [mutate, teamId]);

  const entries = (Array.isArray(data) ? data : []).flatMap<IMessagePlan['content']['entries'][number]>(
    ({ subject, status }) => {
      if (status !== 'pending' && status !== 'in_progress' && status !== 'completed') return [];
      return [{ content: subject, status }];
    }
  );
  return <TaskChecklist entries={entries} compact />;
}
