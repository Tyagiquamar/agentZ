package observer

import (
	"context"
	"log/slog"
	"sync/atomic"
	"time"

	observerdb "github.com/accuknox/agentz/internal/observer/db"
)

type store interface {
	insertBatch(ctx context.Context, batch batch) error
}

type stats struct {
	received uint64
	filtered uint64
	flushed  uint64
	failed   uint64
}

// values returns the current absolute counters.
func (s *stats) values() stats {
	return stats{
		received: atomic.LoadUint64(&s.received),
		filtered: atomic.LoadUint64(&s.filtered),
		flushed:  atomic.LoadUint64(&s.flushed),
		failed:   atomic.LoadUint64(&s.failed),
	}
}

type collector struct {
	processes []processEvent
	files     []fileEvent
	networks  []networkEvent
	traces    []traceSpanEvent
	apps      []observerdb.InsertAppOperationParams
}

func (c *collector) add(ev event) {
	if ev.process != nil {
		c.processes = append(c.processes, *ev.process)
	}
	if ev.file != nil {
		c.files = append(c.files, *ev.file)
	}
	if ev.network != nil {
		c.networks = append(c.networks, *ev.network)
	}
	if ev.trace != nil {
		c.traces = append(c.traces, *ev.trace)
	}
	if ev.app != nil {
		c.apps = append(c.apps, *ev.app)
	}
}

func (c *collector) count() int {
	return len(c.processes) + len(c.files) + len(c.networks) + len(c.traces) + len(c.apps)
}

func (c *collector) flush() batch {
	b := batch{
		processes: c.processes,
		files:     c.files,
		networks:  c.networks,
		traces:    c.traces,
		apps:      c.apps,
	}
	c.processes = nil
	c.files = nil
	c.networks = nil
	c.traces = nil
	c.apps = nil
	return b
}

type sink struct {
	store  store
	stats  *stats
	cfg    Config
	events <-chan event
}

func (s *sink) run(ctx context.Context) {
	ticker := time.NewTicker(s.cfg.FlushInterval)
	defer ticker.Stop()

	c := &collector{}
	flush := func() {
		b := c.flush()
		if b.empty() {
			return
		}
		flushCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 10*time.Second)
		defer cancel()
		if err := s.store.insertBatch(flushCtx, b); err != nil {
			atomic.AddUint64(&s.stats.failed, 1)
			slog.ErrorContext(flushCtx, "flush observer batch", slog.Any("error", err))
			return
		}
		atomic.AddUint64(&s.stats.flushed, 1)
	}

	for {
		select {

		case ev, ok := <-s.events:
			if !ok {
				flush()
				return
			}
			c.add(ev)
			if c.count() >= s.cfg.BatchSize {
				flush()
			}
		case <-ticker.C:
			flush()
		}
	}
}
