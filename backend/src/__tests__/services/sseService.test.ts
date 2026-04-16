import {
  registerConnection,
  removeConnection,
  emit,
  broadcast,
  broadcastAll,
} from '../../services/sseService';

function mockRes() {
  return { write: jest.fn(), end: jest.fn() } as any;
}

describe('sseService', () => {
  beforeEach(() => {
    // Reset the in-memory map by removing any connections added during tests
    removeConnection('user-1');
    removeConnection('user-2');
    removeConnection('user-3');
  });

  describe('registerConnection', () => {
    it('stores a connection and sends an event to it', () => {
      const res = mockRes();
      registerConnection('user-1', res);

      emit('user-1', 'ping', { ts: 1 });

      expect(res.write).toHaveBeenCalledWith('event: ping\ndata: {"ts":1}\n\n');
    });

    it('closes existing connection when a new one is registered for the same user', () => {
      const res1 = mockRes();
      const res2 = mockRes();

      registerConnection('user-1', res1);
      registerConnection('user-1', res2);

      expect(res1.end).toHaveBeenCalledTimes(1);

      emit('user-1', 'test', {});
      expect(res2.write).toHaveBeenCalled();
      expect(res1.write).not.toHaveBeenCalled();
    });
  });

  describe('removeConnection', () => {
    it('stops events from reaching a removed connection', () => {
      const res = mockRes();
      registerConnection('user-1', res);
      removeConnection('user-1');

      emit('user-1', 'test', {});

      expect(res.write).not.toHaveBeenCalled();
    });
  });

  describe('emit', () => {
    it('does nothing if user has no active connection', () => {
      // Should not throw
      expect(() => emit('unknown-user', 'test', {})).not.toThrow();
    });

    it('removes connection if write throws', () => {
      const res = mockRes();
      res.write.mockImplementation(() => { throw new Error('socket closed'); });
      registerConnection('user-1', res);

      emit('user-1', 'test', {});

      // Connection should be cleaned up — emitting again should be a no-op
      const res2 = mockRes();
      registerConnection('user-1', res2);
      emit('user-1', 'test2', {});
      expect(res2.write).toHaveBeenCalled();
    });
  });

  describe('broadcast', () => {
    it('sends to each listed user', () => {
      const r1 = mockRes();
      const r2 = mockRes();
      registerConnection('user-1', r1);
      registerConnection('user-2', r2);

      broadcast(['user-1', 'user-2'], 'notify', { msg: 'hi' });

      expect(r1.write).toHaveBeenCalledWith('event: notify\ndata: {"msg":"hi"}\n\n');
      expect(r2.write).toHaveBeenCalledWith('event: notify\ndata: {"msg":"hi"}\n\n');
    });

    it('skips users without active connections', () => {
      const r1 = mockRes();
      registerConnection('user-1', r1);

      expect(() => broadcast(['user-1', 'no-connection'], 'x', {})).not.toThrow();
      expect(r1.write).toHaveBeenCalledTimes(1);
    });
  });

  describe('broadcastAll', () => {
    it('sends to all currently connected users', () => {
      const r1 = mockRes();
      const r2 = mockRes();
      registerConnection('user-2', r1);
      registerConnection('user-3', r2);

      broadcastAll('global', { value: 42 });

      expect(r1.write).toHaveBeenCalledWith('event: global\ndata: {"value":42}\n\n');
      expect(r2.write).toHaveBeenCalledWith('event: global\ndata: {"value":42}\n\n');
    });
  });
});
