<script lang="ts">
    import {untrack} from "svelte";
    import {ChevronLeft, ChevronRight, Clock, X} from "@lucide/svelte";

    let {
        open = $bindable(false),
        anchor,
        value,
        mode = 'date',
        allowTime = true,
        onChange
    }: {
        open: boolean;
        anchor: HTMLElement | null;
        value: unknown;
        mode?: 'date' | 'datetime';
        allowTime?: boolean;
        onChange: (value: string | null) => void;
    } = $props();

    let popEl: HTMLDivElement | null = $state(null);
    let textEl: HTMLInputElement | null = $state(null);
    let pos: { top: number; left: number } = $state({top: 0, left: 0});
    let textValue = $state('');
    let textFocused = $state(false);

    // Non-empty text that doesn't parse, flag the input as invalid (red)
    const textInvalid = $derived(textValue.trim() !== '' && parseFlexible(textValue) === null);

    const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
    const MONTHS = [
        'January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'
    ];

    // Working selection
    let selY: number | null = $state(null);
    let selM: number | null = $state(null);
    let selD: number | null = $state(null);
    let hasTime = $state(false);
    // hh is canonical 24-hour (0-23)
    let hh = $state(0);
    let mm = $state('00');
    let meridiem: '24' | 'AM' | 'PM' = $state('24');

    const tzLabel = (() => {
        try {
            return Intl.DateTimeFormat().resolvedOptions().timeZone || 'local time';
        } catch {
            return 'local time';
        }
    })();

    const displayHour = $derived(
        meridiem === '24' ? pad(hh) : pad(hh % 12 === 0 ? 12 : hh % 12)
    );

    function commitHour(raw: string) {
        let h = parseInt(raw || '0', 10);
        if (isNaN(h)) h = 0;
        if (meridiem === '24') {
            hh = Math.max(0, Math.min(23, h));
        } else {
            h = Math.max(1, Math.min(12, h));
            hh = (h % 12) + (meridiem === 'PM' ? 12 : 0);
        }
    }

    function changeMeridiem(next: '24' | 'AM' | 'PM') {
        if (next === '24') {
            meridiem = '24';
            return;
        }
        const base = hh % 12;
        hh = next === 'PM' ? base + 12 : base;
        meridiem = next;
    }

    let viewYear = $state(new Date().getFullYear());
    let viewMonth = $state(new Date().getMonth());

    const today = new Date();
    const todayKey = key(today.getFullYear(), today.getMonth(), today.getDate());

    function pad(n: number): string {
        return String(n).padStart(2, '0');
    }

    function key(y: number, m: number, d: number): string {
        return `${y}-${pad(m + 1)}-${pad(d)}`;
    }

    function parse(v: unknown): { y: number; m: number; d: number; hh: string; mm: string; time: boolean } | null {
        if (typeof v !== 'string') return null;
        const m = v.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/);
        if (!m) return null;
        return {
            y: +m[1], m: +m[2] - 1, d: +m[3],
            hh: m[4] ?? '00', mm: m[5] ?? '00',
            time: m[4] !== undefined
        };
    }

    // ── Flexible text parsing (Notion-style) ────────────────────────────────────
    // Accepts: "jul 15", "15 jul", "jan 20 2025", "2025-01-20", "1/20/2025",
    //          "20/1/25", "today", "tomorrow", "yesterday", optional trailing time
    //          like "jul 15 3pm" / "jul 15 15:30".
    const MONTH_LOOKUP: Record<string, number> = {
        jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
        jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11
    };

    function parseFlexible(raw: string): { y: number; m: number; d: number; hh: number | null; mm: number } | null {
        let s = raw.trim().toLowerCase();
        if (!s) return null;
        const n = new Date();

        // Pull an optional trailing time first ("3pm", "3:30 pm", "15:30")
        let th: number | null = null;
        let tm = 0;
        const timeMatch = s.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b|\b(\d{1,2}):(\d{2})\b/);
        if (timeMatch) {
            if (timeMatch[3]) {
                th = parseInt(timeMatch[1], 10) % 12 + (timeMatch[3] === 'pm' ? 12 : 0);
                tm = timeMatch[2] ? parseInt(timeMatch[2], 10) : 0;
            } else {
                th = parseInt(timeMatch[4], 10);
                tm = parseInt(timeMatch[5], 10);
            }
            s = (s.slice(0, timeMatch.index) + s.slice(timeMatch.index! + timeMatch[0].length)).trim();
        }

        const withTime = (y: number, m: number, d: number) => ({
            y, m, d,
            hh: th !== null ? Math.max(0, Math.min(23, th)) : null,
            mm: Math.max(0, Math.min(59, tm))
        });

        // Relative keywords
        if (s === '' && th !== null) return withTime(n.getFullYear(), n.getMonth(), n.getDate());
        if (s === 'today' || s === 'now') return withTime(n.getFullYear(), n.getMonth(), n.getDate());
        if (s === 'tomorrow') {
            const d = new Date(n);
            d.setDate(d.getDate() + 1);
            return withTime(d.getFullYear(), d.getMonth(), d.getDate());
        }
        if (s === 'yesterday') {
            const d = new Date(n);
            d.setDate(d.getDate() - 1);
            return withTime(d.getFullYear(), d.getMonth(), d.getDate());
        }

        // ISO: 2025-01-20
        let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
        if (m) return withTime(+m[1], +m[2] - 1, +m[3]);

        // Numeric slashes: m/d, m/d/yy, m/d/yyyy  (US-style month-first)
        m = s.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
        if (m) {
            let y = m[3] ? +m[3] : n.getFullYear();
            if (y < 100) y += 2000;
            return withTime(y, Math.min(11, +m[1] - 1), +m[2]);
        }

        // Month name forms: "jul 15", "jul 15 2025", "15 jul", "15 jul 2025"
        const mon = s.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/);
        if (mon) {
            const monthIdx = MONTH_LOOKUP[mon[1]];
            const nums = s.replace(mon[0], ' ').match(/\d{1,4}/g) ?? [];
            let day: number | null = null;
            let year = n.getFullYear();
            for (const tok of nums) {
                const v = parseInt(tok, 10);
                if (tok.length === 4 || v > 31) year = v;
                else if (day === null) day = v;
            }
            if (day !== null && day >= 1 && day <= 31) return withTime(year, monthIdx, day);
        }

        return null;
    }

    // Readable form of the current selection, e.g. "Jul 15, 2025" or "Jul 15, 2025 3:30pm"
    function selectionText(): string {
        if (selY === null || selM === null || selD === null) return '';
        const dt = new Date(selY, selM, selD, hh, parseInt(mm, 10) || 0);
        const datePart = dt.toLocaleDateString(undefined, {month: 'short', day: 'numeric', year: 'numeric'});
        if (!showTime) return datePart;
        const t = dt.toLocaleTimeString(undefined, {hour: 'numeric', minute: '2-digit', hour12: meridiem !== '24'})
            .toLowerCase().replace(/\s/g, '');
        return `${datePart} ${t}`;
    }

    function commitText() {
        const p = parseFlexible(textValue);
        if (!p) {
            textValue = selectionText();
            return;
        } // revert invalid input
        selY = p.y;
        selM = p.m;
        selD = p.d;
        viewYear = p.y;
        viewMonth = p.m;
        if (p.hh !== null) {
            hasTime = true;
            hh = p.hh;
            mm = pad(p.mm);
        }
        if (!showTime) {
            onChange(compose());
            open = false;
        }
    }

    const cells = $derived.by(() => {
        const firstWeekday = new Date(viewYear, viewMonth, 1).getDay();
        const out: { y: number; m: number; d: number; outside: boolean }[] = [];
        for (let i = 0; i < 42; i++) {
            const dt = new Date(viewYear, viewMonth, i - firstWeekday + 1);
            out.push({y: dt.getFullYear(), m: dt.getMonth(), d: dt.getDate(), outside: dt.getMonth() !== viewMonth});
        }
        return out;
    });

    const showTime = $derived(mode === 'datetime' || hasTime);
    const hasSelection = $derived(selY !== null && selM !== null && selD !== null);

    function prevMonth() {
        if (viewMonth === 0) {
            viewMonth = 11;
            viewYear--;
        } else viewMonth--;
    }

    function nextMonth() {
        if (viewMonth === 11) {
            viewMonth = 0;
            viewYear++;
        } else viewMonth++;
    }

    function compose(): string | null {
        if (selY === null || selM === null || selD === null) return null;
        const date = key(selY, selM, selD);
        return showTime ? `${date}T${pad(hh)}:${clampMM(mm)}` : date;
    }

    function pickDay(c: { y: number; m: number; d: number }) {
        selY = c.y;
        selM = c.m;
        selD = c.d;
        if (!showTime) {
            onChange(compose());
            open = false;
        }
        // with time: stay open, user adjusts time then Apply
    }

    function apply() {
        onChange(compose());
        open = false;
    }

    function setNow() {
        const n = new Date();
        selY = n.getFullYear();
        selM = n.getMonth();
        selD = n.getDate();
        viewYear = n.getFullYear();
        viewMonth = n.getMonth();
        if (showTime) {
            hh = n.getHours();
            mm = pad(n.getMinutes());
        }
        if (!showTime) {
            onChange(compose());
            open = false;
        }
    }

    function clear() {
        onChange(null);
        open = false;
    }

    function addTime() {
        hasTime = true;
        const n = new Date();
        if (hh === 0 && mm === '00') {
            hh = n.getHours();
            mm = pad(n.getMinutes());
        }
    }

    function clampMM(v: string): string {
        const n = Math.max(0, Math.min(59, parseInt(v || '0', 10) || 0));
        return pad(n);
    }

    function prefers24h(): boolean {
        try {
            return !Intl.DateTimeFormat([], {hour: 'numeric'})
                .resolvedOptions().hour12;
        } catch {
            return false;
        }
    }

    let wasOpen = false;

    $effect(() => {
        if (open && !wasOpen) {
            wasOpen = true;
            untrack(() => {
                const p = parse(value);
                if (p) {
                    selY = p.y;
                    selM = p.m;
                    selD = p.d;
                    viewYear = p.y;
                    viewMonth = p.m;
                    hasTime = p.time;
                    hh = parseInt(p.hh, 10) || 0;
                    mm = p.mm;
                } else {
                    selY = selM = selD = null;
                    viewYear = today.getFullYear();
                    viewMonth = today.getMonth();
                    hasTime = false;
                    hh = 0;
                    mm = '00';
                }
                // default to the locale's 12/24h preference
                meridiem = prefers24h() ? '24' : (hh >= 12 ? 'PM' : 'AM');
                textValue = selectionText();
            });
            requestAnimationFrame(() => {
                position();
                textEl?.focus();
                textEl?.select();
            });
            window.addEventListener('resize', position);
            window.addEventListener('scroll', position, true);
            document.addEventListener('pointerdown', onDocPointerDown);
            document.addEventListener('keydown', onKey);
            return () => {
                window.removeEventListener('resize', position);
                window.removeEventListener('scroll', position, true);
                document.removeEventListener('pointerdown', onDocPointerDown);
                document.removeEventListener('keydown', onKey);
            };
        }
        if (!open) wasOpen = false;
    });

    // Keep the text field mirroring the calendar selection, except while the user
    // is actively typing in it (so we don't clobber their input mid-keystroke).
    $effect(() => {
        selY;
        selM;
        selD;
        hh;
        mm;
        showTime;
        meridiem;
        if (open && !textFocused) untrack(() => textValue = selectionText());
    });

    // Reposition when the popup's height changes (time row / footer toggling)
    $effect(() => {
        showTime;
        hasSelection;
        if (open) requestAnimationFrame(position);
    });

    function position() {
        if (!anchor || !popEl) return;
        const a = anchor.getBoundingClientRect();
        const m = popEl.getBoundingClientRect();
        const margin = 4;
        const pad = 8;
        // Prefer below the anchor; flip above if it would overflow the bottom
        let top = a.bottom + margin;
        if (top + m.height > window.innerHeight - pad) {
            top = a.top - margin - m.height;
        }
        let left = a.left;
        if (left + m.width > window.innerWidth - pad) {
            left = a.right - m.width;
        }
        // Final hard clamp so it can never leave the viewport
        top = Math.max(pad, Math.min(top, window.innerHeight - pad - m.height));
        left = Math.max(pad, Math.min(left, window.innerWidth - pad - m.width));
        pos = {top, left};
    }

    function onDocPointerDown(e: PointerEvent) {
        if (!open) return;
        if (popEl?.contains(e.target as Node)) return;
        if (anchor?.contains(e.target as Node)) return;
        open = false;
    }

    function onKey(e: KeyboardEvent) {
        if (!open) return;
        if (e.key === 'Escape') {
            open = false;
            e.preventDefault();
            return;
        }
        // While typing in the text field, leave arrow keys to the caret
        if (textFocused) return;
        if (e.key === 'ArrowLeft') {
            prevMonth();
            e.preventDefault();
        } else if (e.key === 'ArrowRight') {
            nextMonth();
            e.preventDefault();
        }
    }
</script>

{#if open}
    <div class="pop" bind:this={popEl} style:top="{pos.top}px" style:left="{pos.left}px" role="dialog">
        <input
                class="date-text"
                class:invalid={textInvalid}
                bind:this={textEl}
                bind:value={textValue}
                placeholder="e.g. Jul 15, 2025"
                spellcheck="false"
                autocomplete="off"
                onfocus={() => textFocused = true}
                onblur={(e) => { textFocused = false; if (popEl?.contains(e.relatedTarget as Node)) return; commitText(); }}
                onkeydown={(e) => {
                    if (e.key === 'Enter') { e.preventDefault(); commitText(); }
                    else if (e.key === 'Escape') { e.preventDefault(); open = false; return; }
                    e.stopPropagation();
                }}
        />

        <div class="head">
            <button type="button" class="nav" aria-label="Previous month" onclick={prevMonth}>
                <ChevronLeft size={15} strokeWidth={2}/>
            </button>
            <span class="title">{MONTHS[viewMonth]} {viewYear}</span>
            <button type="button" class="nav" aria-label="Next month" onclick={nextMonth}>
                <ChevronRight size={15} strokeWidth={2}/>
            </button>
        </div>

        <div class="grid weekdays">
            {#each WEEKDAYS as w (w)}<span class="weekday">{w}</span>{/each}
        </div>

        <div class="grid days">
            {#each cells as c (c.y + '-' + c.m + '-' + c.d)}
                {@const k = key(c.y, c.m, c.d)}
                {@const isSel = hasSelection && selY === c.y && selM === c.m && selD === c.d}
                <button
                        type="button"
                        class="day"
                        class:outside={c.outside}
                        class:today={k === todayKey}
                        class:selected={isSel}
                        onclick={() => pickDay(c)}
                >{c.d}</button>
            {/each}
        </div>

        {#if showTime}
            <div class="time-row">
                <span class="clock" title="Times shown in {tzLabel}"><Clock size={13} strokeWidth={1.75}/></span>
                <input
                        class="time-input"
                        inputmode="numeric"
                        maxlength="2"
                        value={displayHour}
                        onblur={(e) => commitHour((e.currentTarget as HTMLInputElement).value)}
                />
                <span class="colon">:</span>
                <input
                        class="time-input"
                        inputmode="numeric"
                        maxlength="2"
                        bind:value={mm}
                        onblur={() => mm = clampMM(mm)}
                />
                <select
                        class="meridiem"
                        value={meridiem}
                        onchange={(e) => changeMeridiem((e.currentTarget as HTMLSelectElement).value as '24' | 'AM' | 'PM')}
                >
                    <option value="24">24h</option>
                    <option value="AM">AM</option>
                    <option value="PM">PM</option>
                </select>
                <button type="button" class="apply" onclick={apply} disabled={!hasSelection}>Apply</button>
            </div>
        {/if}

        <div class="foot">
            <button type="button" class="foot-btn" onclick={setNow}>
                {mode === 'datetime' ? 'Now' : 'Today'}
            </button>
            <div class="foot-right">
                {#if allowTime && mode === 'date' && !hasTime}
                    <button type="button" class="foot-btn" onclick={addTime}>
                        <Clock size={12} strokeWidth={1.75}/>
                        Add time
                    </button>
                {/if}
                {#if hasSelection}
                    <button type="button" class="foot-btn muted" onclick={clear}>
                        <X size={12} strokeWidth={2}/>
                        Clear
                    </button>
                {/if}
            </div>
        </div>
    </div>
{/if}

<style>
    .pop {
        position: fixed;
        z-index: 1000;
        width: 232px;
        max-height: calc(100vh - 16px);
        overflow-y: auto;
        background: var(--color-bg);
        border: 1px solid var(--color-border);
        border-radius: 10px;
        box-shadow: var(--menu-shadow);
        padding: 8px;
        font-family: var(--font-ui);
        color: var(--color-text-primary);
        user-select: none;
    }

    .date-text {
        width: 100%;
        margin-bottom: 8px;
        padding: 6px 8px;
        border: 1px solid var(--color-border);
        border-radius: 6px;
        background: var(--color-bg);
        font: inherit;
        font-size: 13px;
        color: var(--color-text-primary);
        outline: none;
    }

    .date-text:focus {
        border-color: var(--color-ui-muted);
    }

    .date-text.invalid {
        color: var(--error-fg);
        border-color: var(--error-fg);
    }

    .date-text::placeholder {
        color: var(--color-ui-dulled);
    }

    .head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0 2px 6px;
    }

    .title {
        font-size: 12px;
        font-weight: 600;
    }

    .nav {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 22px;
        height: 22px;
        padding: 0;
        border: 0;
        border-radius: 5px;
        background: transparent;
        color: var(--color-ui-muted);
        cursor: pointer;
        transition: background-color 120ms ease, color 120ms ease;
    }

    .nav:hover {
        background: var(--chip-bg-hover);
        color: var(--color-text-primary);
    }

    .grid {
        display: grid;
        grid-template-columns: repeat(7, 1fr);
    }

    .weekday {
        display: flex;
        align-items: center;
        justify-content: center;
        height: 22px;
        font-size: 10px;
        font-weight: 500;
        color: var(--color-ui-dulled);
    }

    .day {
        display: flex;
        align-items: center;
        justify-content: center;
        height: 28px;
        padding: 0;
        border: 0;
        border-radius: 6px;
        background: transparent;
        font: inherit;
        font-size: 12px;
        color: var(--color-text-primary);
        cursor: pointer;
        transition: background-color 100ms ease, color 100ms ease;
    }

    .day:hover {
        background: var(--chip-bg-hover);
    }

    .day.outside {
        color: var(--color-ui-dulled);
    }

    .day.today {
        font-weight: 700;
    }

    .day.selected,
    .day.selected:hover {
        background: var(--color-accent);
        color: #fff;
    }

    .time-row {
        display: flex;
        align-items: center;
        gap: 4px;
        margin-top: 6px;
        padding-top: 6px;
        border-top: 1px solid var(--menu-search-divider);
        color: var(--color-ui-muted);
    }

    .time-input {
        width: 30px;
        padding: 3px 0;
        border: 1px solid var(--color-border);
        border-radius: 5px;
        background: var(--color-bg);
        font: inherit;
        font-size: 12px;
        text-align: center;
        color: var(--color-text-primary);
        outline: none;
    }

    .time-input:focus {
        border-color: var(--focus-border);
    }

    .colon {
        color: var(--color-ui-muted);
    }

    .clock {
        display: inline-flex;
        align-items: center;
        cursor: help;
    }

    .meridiem {
        padding: 3px 2px;
        border: 1px solid var(--color-border);
        border-radius: 5px;
        background: var(--color-bg);
        font: inherit;
        font-size: 11px;
        color: var(--color-text-primary);
        outline: none;
        cursor: pointer;
    }

    .meridiem:focus {
        border-color: var(--focus-border);
    }

    .apply {
        margin-left: auto;
        padding: 4px 10px;
        border: 0;
        border-radius: 5px;
        background: var(--color-accent);
        font: inherit;
        font-size: 12px;
        color: #fff;
        cursor: pointer;
    }

    .apply:disabled {
        opacity: 0.5;
        cursor: default;
    }

    .foot {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 6px;
        margin-top: 6px;
        padding-top: 6px;
        border-top: 1px solid var(--menu-search-divider);
    }

    .foot-right {
        display: flex;
        gap: 2px;
    }

    .foot-btn {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 4px 8px;
        border: 0;
        border-radius: 5px;
        background: transparent;
        font: inherit;
        font-size: 12px;
        color: var(--color-ui-muted);
        cursor: pointer;
        transition: background-color 120ms ease, color 120ms ease;
    }

    .foot-btn:hover {
        background: var(--chip-bg-hover);
        color: var(--color-text-primary);
    }

    .foot-btn.muted {
        color: var(--color-ui-dulled);
    }
</style>
