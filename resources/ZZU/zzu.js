// 郑州大学 (ZZU) 拾光课程表适配脚本
// 支持标准树维 EAMS 教务接口链与综合信息门户微服务日历排课双流水线

(function () {
    const MAX_SUPPORTED_WEEK = 60;

    const EAMS_BASE_URLS = [
        "https://jwxt.zzu.edu.cn",
        "https://info.s.zzu.edu.cn",
        ""
    ];

    const API_BASES = [
        "https://jwxt.zzu.edu.cn/eams-door/api/v1",
        "https://info.s.zzu.edu.cn/portal-api/v1",
        "https://info.s.zzu.edu.cn/eams-door/api/v1",
        "/eams-door/api/v1",
        "/portal-api/v1"
    ];

    // 郑州大学标准 12 节作息时间（第 1-4 节上午，第 5-8 节下午，第 9-12 节晚上）
    const ZZU_TIME_SLOTS = [
        { number: 1, startTime: "08:00", endTime: "08:45" },
        { number: 2, startTime: "08:55", endTime: "09:40" },
        { number: 3, startTime: "10:10", endTime: "10:55" },
        { number: 4, startTime: "11:05", endTime: "11:50" },
        { number: 5, startTime: "14:00", endTime: "14:45" },
        { number: 6, startTime: "14:55", endTime: "15:40" },
        { number: 7, startTime: "16:10", endTime: "16:55" },
        { number: 8, startTime: "17:05", endTime: "17:50" },
        { number: 9, startTime: "19:00", endTime: "19:45" },
        { number: 10, startTime: "19:55", endTime: "20:40" },
        { number: 11, startTime: "20:50", endTime: "21:35" },
        { number: 12, startTime: "21:40", endTime: "22:25" }
    ];

    function toast(message) {
        if (window.shiguangBridge && window.shiguangBridge.showToast) {
            window.shiguangBridge.showToast(message);
        } else {
            console.log("[ZZU Toast]", message);
        }
    }

    async function alertUser(title, message) {
        if (window.shiguangBridgePromise && window.shiguangBridgePromise.showAlert) {
            return await window.shiguangBridgePromise.showAlert(title, message, "确定");
        }
        alert(title + "\n" + message);
        return true;
    }

    function powerSplit(paramsRaw) {
        const args = [];
        let current = "";
        let depth = 0;
        let inQuote = false;
        let quoteChar = "";

        for (let i = 0; i < paramsRaw.length; i++) {
            const char = paramsRaw[i];
            if ((char === '"' || char === "'") && (i === 0 || paramsRaw[i - 1] !== "\\")) {
                if (!inQuote) {
                    inQuote = true;
                    quoteChar = char;
                } else if (char === quoteChar) {
                    inQuote = false;
                }
            }
            if (!inQuote) {
                if (char === "(" || char === "[" || char === "{") depth++;
                if (char === ")" || char === "]" || char === "}") depth--;
            }
            if (char === "," && depth === 0 && !inQuote) {
                args.push(cleanArg(current));
                current = "";
            } else {
                current += char;
            }
        }
        args.push(cleanArg(current));
        return args;
    }

    function cleanArg(value) {
        const trimmed = value.trim();
        if (trimmed === "null") return null;
        return trimmed.replace(/^["']|["']$/g, "");
    }

    function cleanCourseName(name) {
        return String(name || "未知课程").replace(/\([^()]*\)\s*$/, "").trim();
    }

    function cleanPosition(position) {
        return String(position || "未知地点").replace(/\s+/g, " ").trim();
    }

    function cleanString(str) {
        if (!str) return "";
        const s = String(str)
            .replace(/\u00a0/g, " ")
            .replace(/&nbsp;/gi, " ")
            .replace(/\s+/g, " ")
            .trim();
        if (s === "null" || s === "undefined" || s === "none" || s === "无" || s === "空") {
            return "";
        }
        return s;
    }

    function parseWeeksBitmap(bitmap) {
        const weeks = [];
        const value = String(bitmap || "");
        for (let week = 1; week < value.length && week <= MAX_SUPPORTED_WEEK; week++) {
            if (value[week] === "1") weeks.push(week);
        }
        return weeks;
    }

    function mergeContinuousLessons(lessons) {
        if (!lessons || lessons.length === 0) return [];

        const groups = {};
        lessons.forEach(lesson => {
            const key = `${lesson.name}|${lesson.teacher}|${lesson.position}|${lesson.day}`;
            if (!groups[key]) {
                groups[key] = {
                    name: lesson.name,
                    teacher: lesson.teacher,
                    position: lesson.position,
                    day: lesson.day,
                    weeksMatrix: Array.from({ length: MAX_SUPPORTED_WEEK + 1 }, () => new Set())
                };
            }

            if (Array.isArray(lesson.weeks)) {
                lesson.weeks.forEach(week => {
                    if (Number.isInteger(week) && week > 0 && week <= MAX_SUPPORTED_WEEK) {
                        for (let section = lesson.startSection; section <= lesson.endSection; section++) {
                            groups[key].weeksMatrix[week].add(section);
                        }
                    }
                });
            }
        });

        const merged = [];
        for (const key in groups) {
            const group = groups[key];
            const blockMap = {};

            for (let week = 1; week < group.weeksMatrix.length; week++) {
                const sections = Array.from(group.weeksMatrix[week]).sort((a, b) => a - b);
                if (sections.length === 0) continue;

                let start = sections[0];
                let previous = sections[0];
                for (let i = 1; i < sections.length; i++) {
                    const current = sections[i];
                    if (current === previous + 1) {
                        previous = current;
                    } else {
                        const blockKey = `${start}-${previous}`;
                        if (!blockMap[blockKey]) blockMap[blockKey] = [];
                        blockMap[blockKey].push(week);
                        start = current;
                        previous = current;
                    }
                }

                const blockKey = `${start}-${previous}`;
                if (!blockMap[blockKey]) blockMap[blockKey] = [];
                blockMap[blockKey].push(week);
            }

            for (const blockKey in blockMap) {
                const [startSection, endSection] = blockKey.split("-").map(Number);
                const sections = [];
                for (let s = startSection; s <= endSection; s++) sections.push(s);
                merged.push({
                    name: group.name,
                    teacher: group.teacher,
                    position: group.position,
                    day: group.day,
                    startSection,
                    endSection,
                    sections,
                    weeks: blockMap[blockKey]
                });
            }
        }

        merged.sort((a, b) => {
            if (a.day !== b.day) return a.day - b.day;
            if (a.startSection !== b.startSection) return a.startSection - b.startSection;
            if (a.name !== b.name) return a.name.localeCompare(b.name);
            return a.position.localeCompare(b.position);
        });
        return merged;
    }

    function parseTeacherName(block) {
        const teachersMatch = block.match(/actTeachers\s*=\s*\[([\s\S]*?)\]\s*;/);
        if (!teachersMatch) return "未知教师";

        const names = [];
        const nameRegex = /\bname\s*:\s*"([^"]+)"/g;
        let match;
        while ((match = nameRegex.exec(teachersMatch[1])) !== null) {
            if (!names.includes(match[1])) names.push(match[1]);
        }
        return names.length > 0 ? names.join(",") : "未知教师";
    }

    function parseTaskActivities(html) {
        const rawResults = [];
        const unitCountMatch = html.match(/\bunitCount\s*=\s*(\d+)\s*;/);
        const unitCount = unitCountMatch ? parseInt(unitCountMatch[1], 10) : 12;
        const indexRegex = new RegExp(
            `index\\s*=\\s*(\\d+)\\s*\\*\\s*(?:unitCount|${unitCount})\\s*\\+\\s*(\\d+)\\s*;`,
            "g"
        );
        const blocks = html.split(/var\s+teachers\s*=/);

        for (let i = 1; i < blocks.length; i++) {
            const block = blocks[i];
            const teacher = parseTeacherName(block);
            const activityRegex = /new\s+TaskActivity\(([\s\S]*?)\)\s*;/g;
            const activities = [];
            let activityMatch;
            while ((activityMatch = activityRegex.exec(block)) !== null) {
                activities.push({
                    argsRaw: activityMatch[1],
                    start: activityMatch.index,
                    end: activityRegex.lastIndex
                });
            }

            for (let activityIndex = 0; activityIndex < activities.length; activityIndex++) {
                const activity = activities[activityIndex];
                const args = powerSplit(activity.argsRaw);
                if (args.length < 7) continue;

                const name = cleanCourseName(args[3]);
                const position = cleanPosition(args[5]);
                const weeks = parseWeeksBitmap(args[6]);
                if (weeks.length === 0) continue;

                const nextActivityStart = activityIndex + 1 < activities.length
                    ? activities[activityIndex + 1].start
                    : block.length;
                const activityScope = block.slice(activity.end, nextActivityStart);
                indexRegex.lastIndex = 0;
                let indexMatch;
                while ((indexMatch = indexRegex.exec(activityScope)) !== null) {
                    const rawDay = parseInt(indexMatch[1], 10);
                    const rawSection = parseInt(indexMatch[2], 10);
                    if (rawDay < 0 || rawDay > 6 || rawSection < 0 || rawSection >= unitCount) continue;

                    const day = rawDay + 1;
                    const section = rawSection + 1;
                    rawResults.push({
                        name,
                        teacher,
                        position,
                        day,
                        startSection: section,
                        endSection: section,
                        weeks: [...weeks]
                    });
                }
            }
        }

        return mergeContinuousLessons(rawResults);
    }

    function parseParameters(html) {
        if (!html) return null;
        let ids = null;
        const bgMatch = html.match(/bg\.form\.addInput\(\s*form\s*,\s*["']ids["']\s*,\s*["'](\d+)["']\s*\)/);
        if (bgMatch) {
            ids = bgMatch[1];
        } else {
            const inputMatch = html.match(/<input[^>]*name=["']ids["'][^>]*value=["'](\d+)["']/i) ||
                               html.match(/<input[^>]*value=["'](\d+)["'][^>]*name=["']ids["']/i);
            if (inputMatch) ids = inputMatch[1];
        }

        const tagIdMatch = html.match(/id=["'](semesterBar\d+Semester)["']/);
        if (!ids || !tagIdMatch) return null;

        const tagId = tagIdMatch[1];
        const escapedTagId = tagId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const elementMatch = html.match(new RegExp(`<[^>]*\\bid=["']${escapedTagId}["'][^>]*>`, "i"));
        const valueMatch = elementMatch ? elementMatch[0].match(/\bvalue=["'](\d+)["']/i) : null;

        return {
            ids,
            tagId,
            currentSemesterId: valueMatch ? valueMatch[1] : null
        };
    }

    function parseSemesterResponse(raw) {
        const data = Function(`return (${raw});`)();
        const semesters = [];

        for (const key of Object.keys(data.semesters || {})) {
            const entries = Array.isArray(data.semesters[key]) ? data.semesters[key] : [];
            entries.forEach(semester => {
                if (semester && semester.id !== undefined) {
                    const term = String(semester.name || "").trim();
                    const label = /^第.*学期$/.test(term) ? term : `第${term}学期`;
                    semesters.push({
                        id: String(semester.id),
                        schoolYear: String(semester.schoolYear || ""),
                        term,
                        name: `${semester.schoolYear} ${label}`.trim()
                    });
                }
            });
        }

        semesters.sort((a, b) => {
            const yearCompare = b.schoolYear.localeCompare(a.schoolYear);
            if (yearCompare !== 0) return yearCompare;
            return b.term.localeCompare(a.term, undefined, { numeric: true });
        });

        return {
            semesters,
            currentSemesterId: data.semesterId === undefined ? null : String(data.semesterId)
        };
    }

    function normalizeNumericDate(year, month, day) {
        const yearNumber = Number(year);
        const monthNumber = Number(month);
        const dayNumber = Number(day);
        const date = new Date(Date.UTC(yearNumber, monthNumber - 1, dayNumber));
        if (
            date.getUTCFullYear() !== yearNumber ||
            date.getUTCMonth() + 1 !== monthNumber ||
            date.getUTCDate() !== dayNumber
        ) {
            return null;
        }

        return [
            String(yearNumber).padStart(4, "0"),
            String(monthNumber).padStart(2, "0"),
            String(dayNumber).padStart(2, "0")
        ].join("-");
    }

    function parseCalendarInfo(html) {
        const text = String(html || "")
            .replace(/<[^>]*>/g, " ")
            .replace(/&nbsp;|&#160;|&#x0*A0;/gi, " ")
            .replace(/\u00a0/g, " ");
        const match = text.match(
            /开始\s*\/\s*结束日期\s*[：:]?\s*(\d{4})\s*-\s*(\d{1,2})\s*-\s*(\d{1,2})\s*~\s*(\d{4})\s*-\s*(\d{1,2})\s*-\s*(\d{1,2})\s*\(\s*(\d+)\s*\)/
        );
        if (!match) return null;

        const semesterStartDate = normalizeNumericDate(match[1], match[2], match[3]);
        const semesterEndDate = normalizeNumericDate(match[4], match[5], match[6]);
        const semesterTotalWeeks = Number(match[7]);
        if (
            !semesterStartDate ||
            !semesterEndDate ||
            semesterEndDate < semesterStartDate ||
            !Number.isInteger(semesterTotalWeeks) ||
            semesterTotalWeeks < 1 ||
            semesterTotalWeeks > MAX_SUPPORTED_WEEK
        ) {
            return null;
        }

        return {
            semesterStartDate,
            semesterEndDate,
            semesterTotalWeeks,
            firstDayOfWeek: 1
        };
    }

    function getZzuTimeSlots() {
        return ZZU_TIME_SLOTS.map(slot => ({ ...slot }));
    }

    async function request(url, options = {}) {
        const response = await fetch(url, { credentials: "include", ...options });
        if (!response.ok) throw new Error(`网络请求失败: ${response.status}`);
        return await response.text();
    }

    async function detectParameters() {
        for (const base of EAMS_BASE_URLS) {
            try {
                const url = `${base}/eams/courseTableForStd.action`;
                const html = await request(url);
                if (html && (html.includes("semesterBar") || html.includes("ids"))) {
                    const params = parseParameters(html);
                    if (params) {
                        return { ...params, baseUrl: base };
                    }
                }
            } catch (e) {}
        }
        return null;
    }

    async function getSelectedSemester(baseUrl, tagId, currentSemesterId) {
        const form = new URLSearchParams();
        form.set("tagId", tagId);
        form.set("dataType", "semesterCalendar");
        if (currentSemesterId) form.set("value", currentSemesterId);
        form.set("empty", "false");

        const raw = await request(`${baseUrl}/eams/dataQuery.action`, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" },
            body: form.toString()
        });
        const parsed = parseSemesterResponse(raw);
        if (!parsed || parsed.semesters.length === 0) throw new Error("未获取到可选学期");

        const selectedId = currentSemesterId || parsed.currentSemesterId;
        let defaultIndex = parsed.semesters.findIndex(semester => semester.id === selectedId);
        if (defaultIndex < 0) defaultIndex = 0;

        const index = await window.shiguangBridgePromise.showSingleSelection(
            "选择学期",
            JSON.stringify(parsed.semesters.map(semester => semester.name)),
            defaultIndex
        );
        return Number.isInteger(index) && index >= 0 && index < parsed.semesters.length
            ? parsed.semesters[index]
            : null;
    }

    async function fetchAndParseCourses(baseUrl, semesterId, ids) {
        const form = new URLSearchParams();
        form.set("ignoreHead", "1");
        form.set("setting.kind", "std");
        form.set("startWeek", "");
        form.set("semester.id", String(semesterId));
        form.set("ids", String(ids));

        const html = await request(`${baseUrl}/eams/courseTableForStd!courseTable.action`, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" },
            body: form.toString()
        });
        return parseTaskActivities(html);
    }

    async function fetchCalendarInfo(baseUrl, semesterId) {
        const form = new URLSearchParams();
        form.set("version", "1");
        form.set("semesterId", String(semesterId));

        const html = await request(`${baseUrl}/eams/base/calendar-info.action`, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" },
            body: form.toString()
        });
        const calendarInfo = parseCalendarInfo(html);
        if (!calendarInfo) throw new Error("未能解析学期日历");
        return calendarInfo;
    }

    async function trySaveCalendarInfo(baseUrl, semesterId) {
        try {
            const calendarInfo = await fetchCalendarInfo(baseUrl, semesterId);
            if (window.shiguangBridgePromise && window.shiguangBridgePromise.saveCourseConfig) {
                const saveResult = await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify({
                    semesterStartDate: calendarInfo.semesterStartDate,
                    semesterTotalWeeks: calendarInfo.semesterTotalWeeks,
                    firstDayOfWeek: calendarInfo.firstDayOfWeek
                }));
                return saveResult === true;
            }
            return false;
        } catch (error) {
            console.warn(`[ZZU EAMS 学期信息设置失败] ${error.message}`);
            return false;
        }
    }

    async function trySaveTimeSlots() {
        try {
            if (window.shiguangBridgePromise && window.shiguangBridgePromise.savePresetTimeSlots) {
                const saveResult = await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(getZzuTimeSlots()));
                return saveResult === true;
            }
            return false;
        } catch (error) {
            console.warn(`[ZZU 作息时间设置失败] ${error.message}`);
            return false;
        }
    }

    function buildCompletionMessage(calendarSaved, timeSlotsSaved, courseCount) {
        if (calendarSaved && timeSlotsSaved) {
            return `导入成功！共解析 ${courseCount} 门课程，已同步学期日期与郑大作息`;
        }
        if (!calendarSaved && !timeSlotsSaved) {
            return `导入成功！共解析 ${courseCount} 门课程。学期日期与作息设置失败，请在设置中确认`;
        }
        if (!calendarSaved) {
            return `导入成功！共解析 ${courseCount} 门课程。学期日期获取失败，请在设置中确认`;
        }
        return `导入成功！共解析 ${courseCount} 门课程，已同步作息时间`;
    }

    // ──────────────────────────────────────────────────────────
    // 微服务日历排课兜底流水线
    // ──────────────────────────────────────────────────────────

    function scanTokens() {
        const tokens = new Set();
        const jwtRegex = /ey[A-Za-z0-9-_]{10,}\.[A-Za-z0-9-_]{10,}\.[A-Za-z0-9-_]+/g;

        function scanValue(val) {
            if (!val || typeof val !== "string") return;
            let m;
            while ((m = jwtRegex.exec(val)) !== null) {
                tokens.add(m[0]);
            }
            if (val.length > 25 && !val.includes("{") && !val.includes("[")) {
                tokens.add(val.trim());
            }
        }

        try {
            for (let i = 0; i < localStorage.length; i++) {
                const k = localStorage.key(i);
                scanValue(localStorage.getItem(k));
            }
            for (let j = 0; j < sessionStorage.length; j++) {
                const sk = sessionStorage.key(j);
                scanValue(sessionStorage.getItem(sk));
            }
            scanValue(document.cookie);
        } catch (e) {
            console.warn("[ZZU Adapter] scan tokens error:", e);
        }

        return Array.from(tokens);
    }

    function mapTimeToSection(timeStr) {
        if (!timeStr) return 1;
        const clean = parseInt(String(timeStr).replace(/[^0-9]/g, ""), 10) || 800;
        if (clean < 850) return 1;
        if (clean < 1000) return 2;
        if (clean < 1100) return 3;
        if (clean < 1200) return 4;
        if (clean < 1450) return 5;
        if (clean < 1550) return 6;
        if (clean < 1650) return 7;
        if (clean < 1750) return 8;
        if (clean < 1950) return 9;
        if (clean < 2050) return 10;
        if (clean < 2140) return 11;
        return 12;
    }

    function calculateSectionCount(startTime, endTime) {
        if (!startTime || !endTime) return 2;
        const s = parseInt(String(startTime).replace(/[^0-9]/g, ""), 10) || 800;
        const e = parseInt(String(endTime).replace(/[^0-9]/g, ""), 10) || 940;
        const sMin = Math.floor(s / 100) * 60 + (s % 100);
        const eMin = Math.floor(e / 100) * 60 + (e % 100);
        const diff = eMin - sMin;
        if (diff <= 60) return 1;
        if (diff <= 120) return 2;
        if (diff <= 180) return 3;
        return 4;
    }

    function getSemesterMonths() {
        const now = new Date();
        const year = now.getFullYear();
        const month = now.getMonth() + 1;
        const months = [];

        let startYear = year;
        let startMonth = 8;
        if (month >= 2 && month <= 7) {
            startMonth = 2;
        }

        for (let i = 0; i < 6; i++) {
            let m = startMonth + i;
            let y = startYear;
            if (m > 12) {
                m -= 12;
                y += 1;
            }
            const mStr = m < 10 ? "0" + m : "" + m;
            months.push(`${y}-${mStr}`);
        }
        return months;
    }

    async function fetchOneMonthSchedule(monthStr, token) {
        const headers = {
            "Accept": "application/json, text/plain, */*",
            "X-Requested-With": "XMLHttpRequest",
            "X-Device-Info": "Android",
            "X-Terminal-Info": "app"
        };
        if (token) {
            headers["Authorization"] = token.startsWith("Bearer ") ? token : `Bearer ${token}`;
            headers["token"] = token;
            headers["X-Id-Token"] = token;
        }

        for (const base of API_BASES) {
            try {
                const url = `${base}/protal-schedule/getSchedules?date=${monthStr}`;
                const res = await fetch(url, {
                    method: "GET",
                    credentials: "include",
                    headers: headers
                });
                if (res.ok) {
                    const data = await res.json();
                    if (data && typeof data === "object") {
                        const payload = data.data && typeof data.data === "object" ? data.data : data;
                        if (Object.keys(payload).some(k => /^\d{4}-\d{2}-\d{2}$/.test(k))) {
                            return payload;
                        }
                    }
                }
            } catch (e) {}
        }
        return null;
    }

    function aggregateEventsToCourses(monthPayloads) {
        const rawEvents = [];

        monthPayloads.forEach(dataObj => {
            if (!dataObj || typeof dataObj !== "object") return;

            Object.keys(dataObj).forEach(dateKey => {
                if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return;
                const arr = dataObj[dateKey];
                if (!Array.isArray(arr)) return;

                const dateObj = new Date(dateKey + "T00:00:00");
                let dayOfWeek = dateObj.getDay();
                if (dayOfWeek === 0) dayOfWeek = 7;

                arr.forEach(item => {
                    if (!item || typeof item !== "object") return;

                    let name = cleanString(item.context || item.courseName || item.kcmc || item.name || "");
                    if (!name) return;

                    let place = cleanString(item.place || item.classroom || item.cdmc || item.roomName || "");
                    if (!place) place = "教学楼";

                    let teacher = cleanString(item.teacher || item.teacherName || item.jsxm || item.js || "");
                    
                    const m = name.match(/^(.*?)[(（]([^\d()（）\s]{2,6})[)）]$/);
                    if (m) {
                        name = m[1].trim();
                        if (!teacher) teacher = m[2].trim();
                    }

                    const startTime = item.startTime || "08:00";
                    const endTime = item.endTime || "09:40";
                    const weekIndex = parseInt(item.weekIndex || item.week || 1, 10);

                    const startSection = mapTimeToSection(startTime);
                    const sectionCount = calculateSectionCount(startTime, endTime);
                    const endSection = startSection + sectionCount - 1;

                    rawEvents.push({
                        dateKey,
                        name,
                        teacher,
                        position: place,
                        day: dayOfWeek,
                        startSection,
                        endSection,
                        weekIndex
                    });
                });
            });
        });

        const uniqueMap = new Map();
        rawEvents.forEach(ev => {
            const key = `${ev.dateKey}_${ev.name}_${ev.teacher}_${ev.position}_${ev.day}_${ev.startSection}_${ev.weekIndex}`;
            if (!uniqueMap.has(key)) uniqueMap.set(key, ev);
        });

        const groupMap = new Map();
        Array.from(uniqueMap.values()).forEach(ev => {
            const groupKey = `${ev.name}|${ev.teacher}|${ev.position}|${ev.day}|${ev.startSection}|${ev.endSection}`;
            if (!groupMap.has(groupKey)) {
                groupMap.set(groupKey, {
                    name: ev.name,
                    teacher: ev.teacher,
                    position: ev.position,
                    day: ev.day,
                    startSection: ev.startSection,
                    endSection: ev.endSection,
                    weeksSet: new Set()
                });
            }
            if (ev.weekIndex > 0 && ev.weekIndex <= 30) {
                groupMap.get(groupKey).weeksSet.add(ev.weekIndex);
            }
        });

        const resultCourses = [];
        groupMap.forEach(group => {
            const sortedWeeks = Array.from(group.weeksSet).sort((a, b) => a - b);
            if (sortedWeeks.length === 0) {
                for (let w = 1; w <= 16; w++) sortedWeeks.push(w);
            }

            const sections = [];
            for (let s = group.startSection; s <= group.endSection; s++) sections.push(s);

            resultCourses.push({
                name: group.name,
                teacher: group.teacher,
                position: group.position,
                day: group.day,
                startSection: group.startSection,
                endSection: group.endSection,
                sections: sections,
                weeks: sortedWeeks
            });
        });

        return resultCourses;
    }

    function parseUniAppDOM() {
        const courses = [];
        try {
            const elements = document.querySelectorAll(".uni-card, .schedule-card, .course-item, .lesson-item, .grid-item, tr, td");
            elements.forEach(el => {
                const text = el.innerText || el.textContent || "";
                if (!text || text.length < 5 || text.length > 200) return;

                const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
                if (lines.length >= 2) {
                    const name = lines[0];
                    if (name.includes("星期") || name.includes("节次") || name.includes("学期")) return;

                    let place = "教学楼";
                    let teacher = "";
                    lines.slice(1).forEach(l => {
                        if (l.includes("楼") || l.includes("室") || l.includes("-")) place = l;
                        else if (l.length <= 5 && !l.includes("周") && !l.includes(":")) teacher = l;
                    });

                    courses.push({
                        name: cleanString(name),
                        teacher: cleanString(teacher),
                        position: cleanString(place),
                        day: 1,
                        startSection: 1,
                        endSection: 2,
                        sections: [1, 2],
                        weeks: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]
                    });
                }
            });
        } catch (e) {}
        return courses.length > 0 ? courses : null;
    }

    async function saveToShiguangApp(courses) {
        const allWeeks = courses.flatMap(c => c.weeks || []);
        const maxWeek = allWeeks.length > 0 ? Math.max(...allWeeks) : 20;

        const config = {
            semesterTotalWeeks: Math.max(maxWeek, 18),
            firstDayOfWeek: 1,
            defaultClassDuration: 45,
            defaultBreakDuration: 10
        };

        if (window.shiguangBridgePromise && window.shiguangBridgePromise.saveCourseConfig) {
            await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify(config));
        }

        if (window.shiguangBridgePromise && window.shiguangBridgePromise.savePresetTimeSlots) {
            await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(ZZU_TIME_SLOTS));
        }

        if (window.shiguangBridgePromise && window.shiguangBridgePromise.saveImportedCourses) {
            return await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(courses));
        }

        return true;
    }

    async function runMicroserviceFallback() {
        toast("正在尝试微服务排课接口拉取...");
        const tokenList = scanTokens();
        const months = getSemesterMonths();
        let validMonthData = [];

        const tokensToTry = tokenList.length > 0 ? tokenList : [""];
        for (const t of tokensToTry) {
            const fetchPromises = months.map(m => fetchOneMonthSchedule(m, t));
            const results = (await Promise.all(fetchPromises)).filter(Boolean);
            if (results.length > 0) {
                validMonthData = results;
                break;
            }
        }

        let courses = [];
        if (validMonthData.length > 0) {
            courses = aggregateEventsToCourses(validMonthData);
        }

        if (courses.length === 0) {
            const domCourses = parseUniAppDOM();
            if (domCourses && domCourses.length > 0) {
                courses = domCourses;
            }
        }

        if (courses.length === 0) {
            return false;
        }

        const ok = await saveToShiguangApp(courses);
        if (!ok) {
            toast("保存课表失败，请稍后重试");
            return true;
        }

        toast(`导入成功！共解析 ${courses.length} 门课程。提示：在设置开学日期后，课表才会正常显示！`);
        if (window.shiguangBridge && window.shiguangBridge.notifyTaskCompletion) {
            window.shiguangBridge.notifyTaskCompletion();
        }
        return true;
    }

    // ──────────────────────────────────────────────────────────
    // 主执行入口
    // ──────────────────────────────────────────────────────────

    async function runImportFlow() {
        try {
            const currentUrl = window.location.href;

            if (currentUrl.includes("cas.s.zzu.edu.cn/cas/login") && !currentUrl.includes("ticket=")) {
                const hasPassword = !!document.querySelector("input[type='password']");
                if (hasPassword) {
                    toast("请先输入账号密码与短信验证码登录统一身份认证");
                    return;
                }
            }

            toast("正在探测郑大教务系统参数...");
            let eamsSuccess = false;

            try {
                const params = await detectParameters();
                if (params) {
                    const semester = await getSelectedSemester(params.baseUrl, params.tagId, params.currentSemesterId);
                    if (semester) {
                        toast("正在同步教务课表...");
                        const courses = await fetchAndParseCourses(params.baseUrl, semester.id, params.ids);
                        if (courses && courses.length > 0) {
                            if (window.shiguangBridgePromise && window.shiguangBridgePromise.saveImportedCourses) {
                                const saveResult = await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(courses));
                                if (!saveResult) throw new Error("课程保存失败");
                            }

                            const calendarSaved = await trySaveCalendarInfo(params.baseUrl, semester.id);
                            const timeSlotsSaved = await trySaveTimeSlots();
                            toast(buildCompletionMessage(calendarSaved, timeSlotsSaved, courses.length));
                            if (window.shiguangBridge && window.shiguangBridge.notifyTaskCompletion) {
                                window.shiguangBridge.notifyTaskCompletion();
                            }
                            eamsSuccess = true;
                        }
                    } else {
                        return;
                    }
                }
            } catch (eamsError) {
                console.warn("[ZZU EAMS 流水线异常，尝试微服务兜底]", eamsError.message);
            }

            if (!eamsSuccess) {
                const fallbackOk = await runMicroserviceFallback();
                if (!fallbackOk) {
                    await alertUser(
                        "未获取到课表数据",
                        "请确认已成功登录郑大教务系统或信息门户。"
                    );
                }
            }
        } catch (error) {
            console.error("[ZZU 导入异常]", error);
            await alertUser("导入异常", error && error.message ? error.message : String(error));
        }
    }

    if (typeof module !== "undefined" && module.exports) {
        module.exports = {
            ZZU_TIME_SLOTS,
            powerSplit,
            parseWeeksBitmap,
            mergeContinuousLessons,
            parseTeacherName,
            parseTaskActivities,
            parseParameters,
            parseSemesterResponse,
            parseCalendarInfo,
            scanTokens,
            calculateSectionCount,
            mapTimeToSection,
            aggregateEventsToCourses,
            detectParameters,
            runImportFlow
        };
    } else {
        runImportFlow();
    }
})();

