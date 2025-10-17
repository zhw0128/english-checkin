'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabaseClient'; // ← 如你的路径是 "@/utils/..."，这里改一下

// ==================== 配置 ====================
const LESSONS_BUCKET = 'lessons';      // 你放音频/PDF的 bucket 名
const RECORDINGS_BUCKET = 'recordings'; // 学生录音上传的 bucket 名
const LIST_PREFIX = '';                 // 列出 lessons 根目录；如你用子文件夹，可改成 '2025-10/'
const AUTO_REFRESH_MS = 60_000;         // 自动刷新间隔（毫秒）
// ============================================

// 支持的音频后缀
const AUDIO_RE = /\.(mp3|m4a|webm|wav|ogg)$/i;
const PDF_RE = /\.pdf$/i;

type StorageObj = {
  name: string;         // 文件名（不含路径）
  id?: string;          // supabase sdk 没有 id，这里不用
  updated_at?: string;  // 可能用不到
};

type LessonItem = {
  key: string;          // 课的“基名”（文件名去后缀）
  audioUrl: string;     // 公网音频链接
  pdfUrl: string;       // 公网PDF链接
};

function getCid() {
  if (typeof window === 'undefined') return '';
  let cid = localStorage.getItem('cid');
  if (!cid) {
    cid = `anon_${Math.random().toString(36).slice(2, 8)}`;
    localStorage.setItem('cid', cid);
  }
  return cid;
}

export default function Page() {
  const [items, setItems] = useState<LessonItem[]>([]);
  const [loading, setLoading] = useState(true);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  // 加载 lessons bucket 里的文件并配对
  const loadFromStorage = async () => {
    setLoading(true);

    // 列出指定目录（Supabase Storage 不支持递归；如需子目录，请把 LIST_PREFIX 改成对应子目录）
    const { data, error } = await supabase
      .storage
      .from(LESSONS_BUCKET)
      .list(LIST_PREFIX, { limit: 1000 });

    if (error) {
      console.error('list lessons error:', error);
      setItems([]);
      setLoading(false);
      return;
    }

    const files = (data || []) as StorageObj[];

    // 用“基名”配对音频与PDF
    const map = new Map<string, { audio?: string; pdf?: string }>();
    for (const f of files) {
      const name = f.name;
      const base = name.replace(/\.(mp3|m4a|webm|wav|ogg|pdf)$/i, '');
      const entry = map.get(base) || {};
      if (AUDIO_RE.test(name)) entry.audio = name;
      if (PDF_RE.test(name)) entry.pdf = name;
      map.set(base, entry);
    }

    // 生成可渲染数据（转成 Public URL）
    const list: LessonItem[] = [];
    for (const [base, v] of map.entries()) {
      const audioUrl = v.audio
        ? supabase.storage.from(LESSONS_BUCKET).getPublicUrl(`${LIST_PREFIX}${v.audio}`).data.publicUrl
        : '';
      const pdfUrl = v.pdf
        ? supabase.storage.from(LESSONS_BUCKET).getPublicUrl(`${LIST_PREFIX}${v.pdf}`).data.publicUrl
        : '';
      if (audioUrl || pdfUrl) {
        list.push({ key: base, audioUrl, pdfUrl });
      }
    }

    // 可按名称排序（可改成时间排序）
    list.sort((a, b) => a.key.localeCompare(b.key));
    setItems(list);
    setLoading(false);
  };

  useEffect(() => {
    loadFromStorage();
    // 每60秒自动刷新
    timer.current = setInterval(loadFromStorage, AUTO_REFRESH_MS);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, []);

  return (
    <main style={{ maxWidth: 860, margin: '0 auto', padding: 16 }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1>🎧 English Listening Check-in</h1>
        <button onClick={loadFromStorage}>🔄 刷新</button>
      </header>

      {loading && <p>正在加载课件...</p>}
      {!loading && items.length === 0 && (
        <p>还没有找到课件文件。请把 <code>.mp3/.m4a/.webm</code> 与 <code>.pdf</code> 同名文件上传到 <b>{LESSONS_BUCKET}/</b> 根目录。</p>
      )}

      <ul style={{ listStyle: 'none', padding: 0 }}>
        {items.map(item => (
          <li key={item.key} style={{ border: '1px solid #e5e7eb', borderRadius: 12, padding: 16, marginTop: 16 }}>
            <h3 style={{ margin: '0 0 8px' }}>{item.key}</h3>
            <LessonCard lesson={item} />
          </li>
        ))}
      </ul>
    </main>
  );
}

function LessonCard({ lesson }: { lesson: LessonItem }) {
  const [recording, setRecording] = useState(false);
  const [rec, setRec] = useState<MediaRecorder | null>(null);
  const [chunks, setChunks] = useState<Blob[]>([]);
  const [listened, setListened] = useState(false);

  // 进入时检查本设备是否已完成（本地 + 可选远端）
useEffect(() => {
  const cid = getCid();

  (async () => {
    try {
      const { count, error } = await supabase
        .from('listens')
        .select('id', { head: true, count: 'exact' })
        // 如果你表里是 lesson_key，就用 lesson.key；如果你是 lesson_id 就用 lesson.id
        .eq('lesson_key', lesson.key)
        .eq('cid', cid);

      if (!error && (count ?? 0) > 0) setListened(true);
    } catch {
      // 忽略远端错误，不影响本地UI
    }
  })();
}, [lesson.key]);


  // 播放完自动打✅（本地 + 可选写库）
  const markListen = async () => {
    setListened(true);
    localStorage.setItem(`done:${lesson.key}`, '1');

    // 可选：写入 public.listens（如果表和策略都准备好了）
    try {
      const cid = getCid();
      await supabase
        .from('listens')
        .upsert([{ cid, lesson_key: lesson.key }], { onConflict: 'cid,lesson_key' });
    } catch {
      // 不阻塞UI
    }
  };

  // ======== 录音并上传（移动端兼容）========
  async function startRec() {
    const prefer =
      (typeof MediaRecorder !== 'undefined' &&
        (MediaRecorder as any).isTypeSupported?.('audio/webm;codecs=opus'))
        ? 'audio/webm;codecs=opus'
        : ((MediaRecorder as any).isTypeSupported?.('audio/mp4') ? 'audio/mp4' : '');

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mr = prefer ? new MediaRecorder(stream, { mimeType: prefer }) : new MediaRecorder(stream);

    setChunks([]);
    mr.ondataavailable = (e) => setChunks(prev => [...prev, e.data]);

    mr.onstop = async () => {
      const mime = mr.mimeType || prefer || 'audio/webm';
      const blob = new Blob(chunks, { type: mime });

      if (!blob || blob.size < 1024) {
        alert('录音数据为空或太短，请多录几秒再试');
        return;
      }

      const ext = mime.includes('mp4') ? 'm4a'
                : mime.includes('mpeg') ? 'mp3'
                : 'webm';

      const file = new File([blob], `reading-${Date.now()}.${ext}`, { type: mime });
      const cid = getCid();
      const path = `${cid}/${encodeURIComponent(lesson.key)}/${Date.now()}.${ext}`;

      try {
        const { error } = await supabase
          .storage
          .from(RECORDINGS_BUCKET)
          .upload(path, file, { contentType: file.type });

        if (error) throw error;
        alert('录音已上传 ✅');
      } catch (err: any) {
        console.error('上传失败:', err);
        alert('上传失败：' + (err?.message || '未知错误'));
      } finally {
        setChunks([]);
      }
    };

    mr.start();
    setRec(mr);
    setRecording(true);
  }

  function stopRec() {
    rec?.stop();
    setRecording(false);
  }

  return (
    <div>
      {lesson.audioUrl ? (
        <audio controls src={lesson.audioUrl} onEnded={markListen} />
      ) : (
        <em>暂无音频</em>
      )}

      {listened && (
        <p style={{ color: '#16a34a', marginTop: 8 }}>已完成听读 ✅</p>
      )}

      {lesson.pdfUrl && (
        <p style={{ marginTop: 8 }}>
          <a href={lesson.pdfUrl} target="_blank" rel="noreferrer">
            📄 查看讲义（PDF）
          </a>
        </p>
      )}

      <div style={{ marginTop: 8 }}>
        {!recording ? (
          <button onClick={startRec}>🎤 开始录音</button>
        ) : (
          <button onClick={stopRec}>⏹ 停止录音并上传</button>
        )}
      </div>
    </div>
  );
}
