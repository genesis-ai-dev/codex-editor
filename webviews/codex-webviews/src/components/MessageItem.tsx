import React from 'react';
import { ChatMessageWithContext } from '../../../../types';
import { VSCodeTag } from '@vscode/webview-ui-toolkit/react';
import { ChatRoleLabel } from '../common';

interface MessageItemProps {
  messageItem: ChatMessageWithContext;
  showSenderRoleLabels?: boolean;
}

export const MessageItem: React.FC<MessageItemProps> = ({
  messageItem,
  showSenderRoleLabels = false,
}) => {
  return (
    <div
      style={{
        display: messageItem.role === 'system' ? 'none' : 'flex',
        flexDirection: 'column',
        gap: '0.5em',
        justifyContent:
          messageItem.role === 'user'
            ? 'flex-start'
            : messageItem.role === 'assistant'
            ? 'flex-end'
            : 'center',
        padding: '0.5em 1em',
        // maxWidth: messageItem.role === "context" ? "100%" : "80%", // full width for 'context' messages
        alignSelf:
          messageItem.role === 'assistant'
            ? 'flex-start'
            : messageItem.role === 'user'
            ? 'flex-end'
            : 'center',
      }}
    >
      {(messageItem.role === 'user' || messageItem.role === 'assistant') && (
        <div
          style={{
            fontSize: '0.7em',
            color: 'lightgrey',
            marginBottom: '0.2em',
            marginLeft: messageItem.role === 'assistant' ? '9px' : '0px',
            marginRight: messageItem.role === 'user' ? '9px' : '0px',
            alignSelf:
              messageItem.role === 'assistant' ? 'flex-start' : 'flex-end',
          }}
        >
          {new Date(messageItem.createdAt).toLocaleTimeString()}{' '}
          {/* FIXME: add actual timestamps */}
        </div>
      )}
      <div
        style={{
          display: messageItem.role === 'system' ? 'none' : 'flex',
          flexDirection:
            messageItem.role === 'assistant'
              ? 'row'
              : messageItem.role === 'user'
              ? 'row-reverse'
              : 'column',
          gap: '0.5em',
          justifyContent:
            messageItem.role === 'assistant'
              ? 'flex-start'
              : messageItem.role === 'user'
              ? 'flex-end'
              : 'center',
          borderRadius: '20px',
          backgroundColor:
            messageItem.role === 'assistant'
              ? 'var(--vscode-editor-background)'
              : messageItem.role === 'user'
              ? 'var(--vscode-button-background)'
              : 'lightblue', // distinct style for 'context' messages
          color:
            messageItem.role === 'assistant'
              ? 'var(--vscode-editor-foreground)'
              : messageItem.role === 'user'
              ? 'var(--vscode-button-foreground)'
              : 'black', // distinct style for 'context' messages
          padding: '0.5em 1em',
          // maxWidth: messageItem.role === "context" ? "100%" : "80%", // full width for 'context' messages
          alignSelf:
            messageItem.role === 'assistant'
              ? 'flex-start'
              : messageItem.role === 'user'
              ? 'flex-end'
              : 'center',
        }}
      >
        {showSenderRoleLabels && (
          <VSCodeTag>
            {ChatRoleLabel[messageItem.role as keyof typeof ChatRoleLabel]}
          </VSCodeTag>
        )}
        <div style={{ display: 'flex' }}>{messageItem.content}</div>
      </div>
    </div>
  );
};
