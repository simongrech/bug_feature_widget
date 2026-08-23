import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Item } from '../src/Item';
import { item } from './fixtures';

const noop = async () => {};

describe('Item', () => {
  it('shows text, author, level and a formatted time', () => {
    const row = item({
      text: 'Login fails',
      criticality: 'high',
      reporterName: 'Ada Lovelace',
    });
    const { container } = render(<Item item={row} kind="bug" onSave={noop} onDelete={noop} />);
    expect(screen.getByText('Login fails')).toBeInTheDocument();
    expect(screen.getByText('high')).toBeInTheDocument();
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
    expect(container.querySelector('time')).toHaveAttribute('dateTime', row.createdAt);
  });

  it('lets the reporter edit and delete their own open item', () => {
    render(<Item item={item({ mine: true })} kind="bug" onSave={noop} onDelete={noop} />);
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
  });

  it('hides edit and delete once the hub has archived the item, or when it is not theirs', () => {
    const { rerender } = render(
      <Item item={item({ mine: true, completed: true })} kind="bug" onSave={noop} onDelete={noop} />,
    );
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
    expect(screen.getByText('Done')).toBeInTheDocument();

    rerender(
      <Item item={item({ mine: true, rejected: true })} kind="bug" onSave={noop} onDelete={noop} />,
    );
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
    expect(screen.getByText('Rejected')).toBeInTheDocument();

    rerender(<Item item={item({ mine: false })} kind="bug" onSave={noop} onDelete={noop} />);
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
  });

  it('still allows edits on an approved item that has not been archived', () => {
    render(
      <Item item={item({ mine: true, approved: true })} kind="bug" onSave={noop} onDelete={noop} />,
    );
    expect(screen.getByText('Approved')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
  });

  it('keeps a pending item editable even if it is also marked archived', () => {
    render(
      <Item
        item={item({ mine: true, pending: true, completed: true })}
        kind="bug"
        onSave={noop}
        onDelete={noop}
      />,
    );
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
  });

  it('saves a changed draft and ignores an unchanged or empty one', async () => {
    const onSave = vi.fn(async () => {});
    const user = userEvent.setup();
    render(<Item item={item({ text: 'Original' })} kind="bug" onSave={onSave} onDelete={noop} />);

    await user.click(screen.getByRole('button', { name: 'Edit' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Edit' }));
    await user.clear(screen.getByRole('textbox'));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Edit' }));
    await user.clear(screen.getByRole('textbox'));
    await user.type(screen.getByRole('textbox'), 'Changed');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith('1', 'Changed'));
  });

  it('cancels editing without saving', async () => {
    const onSave = vi.fn(async () => {});
    const user = userEvent.setup();
    render(<Item item={item({ text: 'Original' })} kind="bug" onSave={onSave} onDelete={noop} />);
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    await user.type(screen.getByRole('textbox'), ' nope');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText('Original')).toBeInTheDocument();
  });

  it('calls onDelete for the item id', async () => {
    const onDelete = vi.fn(async () => {});
    const user = userEvent.setup();
    render(<Item item={item({ id: 'abc' })} kind="bug" onSave={noop} onDelete={onDelete} />);
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onDelete).toHaveBeenCalledWith('abc');
  });

  it('shows priority rather than criticality on a feature', () => {
    render(
      <Item
        item={item({ kind: 'feature', priority: 'high', criticality: 'critical' })}
        kind="feature"
        onSave={noop}
        onDelete={noop}
      />,
    );
    expect(screen.getByText('high')).toBeInTheDocument();
    expect(screen.queryByText('critical')).not.toBeInTheDocument();
  });
});
