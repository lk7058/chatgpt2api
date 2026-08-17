"use client";

import { useEffect, useRef, useState } from "react";
import { Eye, FileText, LoaderCircle, Pencil, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  deleteEmailTemplate,
  fetchEmailTemplates,
  previewEmailTemplate,
  saveEmailTemplate,
  type EmailTemplate,
} from "@/lib/api";

function RichTextEditor({ value, onChange }: { value: string; onChange: (html: string) => void }) {
  const editorRef = useRef<HTMLDivElement>(null);

  // 外部内容变化（如打开编辑模板）时同步到编辑器
  useEffect(() => {
    if (editorRef.current && editorRef.current.innerHTML !== value) {
      editorRef.current.innerHTML = value;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const exec = (command: string, value?: string) => {
    const editor = editorRef.current;
    if (!editor) {
      return;
    }
    editor.focus();
    document.execCommand(command, false, value);
    onChange(editor.innerHTML);
  };

  const insertVariable = (variable: string) => {
    const editor = editorRef.current;
    if (!editor) {
      return;
    }
    editor.focus();
    document.execCommand("insertText", false, `{{${variable}}}`);
    onChange(editor.innerHTML);
  };

  const toolbarButton =
    "inline-flex h-7 min-w-7 items-center justify-center rounded-md px-1.5 text-xs font-medium text-stone-600 transition hover:bg-stone-200";

  return (
    <div className="overflow-hidden rounded-xl border border-stone-200">
      <div className="flex flex-wrap items-center gap-0.5 border-b border-stone-100 bg-stone-50 px-2 py-1.5">
        <button type="button" className={toolbarButton} onMouseDown={(e) => e.preventDefault()} onClick={() => exec("bold")} title="加粗">
          <b>B</b>
        </button>
        <button type="button" className={toolbarButton} onMouseDown={(e) => e.preventDefault()} onClick={() => exec("italic")} title="斜体">
          <i>I</i>
        </button>
        <button type="button" className={toolbarButton} onMouseDown={(e) => e.preventDefault()} onClick={() => exec("underline")} title="下划线">
          <u>U</u>
        </button>
        <button type="button" className={toolbarButton} onMouseDown={(e) => e.preventDefault()} onClick={() => exec("strikeThrough")} title="删除线">
          <s>S</s>
        </button>
        <span className="mx-1 h-4 w-px bg-stone-200" />
        <button type="button" className={toolbarButton} onMouseDown={(e) => e.preventDefault()} onClick={() => exec("insertUnorderedList")} title="无序列表">
          • 列表
        </button>
        <button type="button" className={toolbarButton} onMouseDown={(e) => e.preventDefault()} onClick={() => exec("insertOrderedList")} title="有序列表">
          1. 列表
        </button>
        <span className="mx-1 h-4 w-px bg-stone-200" />
        <button
          type="button"
          className={toolbarButton}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            const url = window.prompt("请输入链接地址（http://...）");
            if (url) {
              exec("createLink", url);
            }
          }}
          title="插入链接"
        >
          链接
        </button>
        <button type="button" className={toolbarButton} onMouseDown={(e) => e.preventDefault()} onClick={() => exec("removeFormat")} title="清除格式">
          清除格式
        </button>
      </div>
      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        onInput={(event) => onChange((event.target as HTMLDivElement).innerHTML)}
        className="min-h-44 px-3 py-2 text-sm leading-6 text-stone-800 outline-none"
      />
    </div>
  );
}

export function EmailTemplateManager() {
  const [items, setItems] = useState<EmailTemplate[]>([]);
  const [scenes, setScenes] = useState<Record<string, string>>({});
  const [variables, setVariables] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formName, setFormName] = useState("");
  const [formScene, setFormScene] = useState("");
  const [formSubject, setFormSubject] = useState("");
  const [formBodyHtml, setFormBodyHtml] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const [preview, setPreview] = useState<{ subject: string; body_html: string } | null>(null);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [deleting, setDeleting] = useState<EmailTemplate | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const load = async () => {
    setIsLoading(true);
    try {
      const data = await fetchEmailTemplates();
      setItems(data.items);
      setScenes(data.scenes || {});
      setVariables(data.variables || []);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "加载邮件模板失败");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const openCreate = () => {
    setEditingId(null);
    setFormName("");
    setFormScene(Object.keys(scenes)[0] || "register_code");
    setFormSubject("");
    setFormBodyHtml("");
    setPreview(null);
    setEditorOpen(true);
  };

  const openEdit = (item: EmailTemplate) => {
    setEditingId(item.id);
    setFormName(item.name);
    setFormScene(item.scene);
    setFormSubject(item.subject);
    setFormBodyHtml(item.body_html);
    setPreview(null);
    setEditorOpen(true);
  };

  const handleSave = async () => {
    // 必填校验，给出明确错误提示
    if (!formName.trim()) {
      toast.error("请填写模板名称");
      return;
    }
    if (!formScene) {
      toast.error("请选择邮件场景");
      return;
    }
    if (!formSubject.trim()) {
      toast.error("请填写邮件主题");
      return;
    }
    const trimmedBody = formBodyHtml.replace(/<br\s*\/?>/gi, "").replace(/<p>\s*<\/p>/g, "").trim();
    if (!trimmedBody) {
      toast.error("请填写邮件正文内容");
      return;
    }
    setIsSaving(true);
    try {
      const data = await saveEmailTemplate({
        id: editingId || undefined,
        name: formName.trim(),
        scene: formScene,
        subject: formSubject.trim(),
        body_html: formBodyHtml,
      });
      setItems(data.items);
      setEditorOpen(false);
      toast.success(editingId ? "模板已更新" : "模板已创建");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "保存模板失败");
    } finally {
      setIsSaving(false);
    }
  };

  const handlePreview = async () => {
    if (!formSubject.trim()) {
      toast.error("请填写邮件主题后再预览");
      return;
    }
    const trimmedBody = formBodyHtml.replace(/<br\s*\/?>/gi, "").replace(/<p>\s*<\/p>/g, "").trim();
    if (!trimmedBody) {
      toast.error("请填写邮件正文内容后再预览");
      return;
    }
    setIsPreviewing(true);
    try {
      const data = await previewEmailTemplate({ subject: formSubject, body_html: formBodyHtml });
      setPreview(data);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "预览失败");
    } finally {
      setIsPreviewing(false);
    }
  };

  const handleDelete = async () => {
    if (!deleting) {
      return;
    }
    setIsDeleting(true);
    try {
      const data = await deleteEmailTemplate(deleting.id);
      setItems(data.items);
      setDeleting(null);
      toast.success("模板已删除");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "删除失败");
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <>
      <Card className="rounded-2xl border-white/80 bg-white/90 shadow-sm">
        <CardContent className="space-y-4 p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-xl bg-stone-100">
                <FileText className="size-5 text-stone-600" />
              </div>
              <div>
                <h2 className="text-lg font-semibold tracking-tight">邮件模板设置</h2>
                <p className="text-sm text-stone-500">
                  自定义各场景邮件的主题与正文，支持 {"{{username}}"}、{"{{code}}"} 等变量占位符；未配置时使用内置默认文案。
                </p>
              </div>
            </div>
            <Button className="h-9 shrink-0 rounded-xl bg-stone-950 px-4 text-white hover:bg-stone-800" onClick={openCreate}>
              <Plus className="size-4" />
              新建模板
            </Button>
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center p-8">
              <LoaderCircle className="size-5 animate-spin text-stone-400" />
            </div>
          ) : items.length === 0 ? (
            <div className="rounded-xl border border-dashed border-stone-200 px-4 py-10 text-center text-sm text-stone-400">
              暂无邮件模板，点击右上角「新建模板」创建；不配置模板时邮件使用内置默认内容。
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-stone-200">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead>
                  <tr className="border-b border-stone-200 bg-stone-50 text-xs text-stone-500">
                    <th className="px-4 py-3 font-medium">名称</th>
                    <th className="px-4 py-3 font-medium">场景</th>
                    <th className="px-4 py-3 font-medium">主题</th>
                    <th className="px-4 py-3 font-medium">更新时间</th>
                    <th className="px-4 py-3 text-right font-medium">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.id} className="border-b border-stone-100 last:border-0">
                      <td className="px-4 py-3 font-medium text-stone-900">{item.name}</td>
                      <td className="px-4 py-3">
                        <Badge variant="secondary" className="bg-stone-100 text-stone-600">
                          {scenes[item.scene] || item.scene}
                        </Badge>
                      </td>
                      <td className="max-w-[260px] truncate px-4 py-3 text-stone-600">{item.subject}</td>
                      <td className="px-4 py-3 whitespace-nowrap text-xs text-stone-500">{item.updated_at}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <Button type="button" variant="ghost" className="h-8 rounded-lg px-2 text-xs text-stone-600" onClick={() => openEdit(item)}>
                            <Pencil className="size-3.5" /> 编辑
                          </Button>
                          <Button type="button" variant="ghost" className="h-8 rounded-lg px-2 text-xs text-rose-600" onClick={() => setDeleting(item)}>
                            <Trash2 className="size-3.5" /> 删除
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 编辑器 */}
      <Dialog open={editorOpen} onOpenChange={setEditorOpen}>
        <DialogContent className="max-w-2xl rounded-2xl p-6">
          <DialogHeader className="gap-2">
            <DialogTitle>{editingId ? "编辑邮件模板" : "新建邮件模板"}</DialogTitle>
            <DialogDescription className="text-sm leading-6">
              支持变量占位符（如 {"{{username}}"}、{"{{code}}"}）会在发送时自动替换为实际值。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <label className="text-sm text-stone-700">
                  模板名称 <span className="text-rose-500">*</span>
                </label>
                <Input value={formName} onChange={(event) => setFormName(event.target.value)} placeholder="如：注册验证码模板" className="h-10 rounded-xl border-stone-200 bg-white" />
              </div>
              <div className="space-y-2">
                <label className="text-sm text-stone-700">
                  邮件场景 <span className="text-rose-500">*</span>
                </label>
                <Select value={formScene} onValueChange={setFormScene}>
                  <SelectTrigger className="h-10 rounded-xl border-stone-200 bg-white">
                    <SelectValue placeholder="选择场景" />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(scenes).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-sm text-stone-700">
                邮件主题 <span className="text-rose-500">*</span>
              </label>
              <Input value={formSubject} onChange={(event) => setFormSubject(event.target.value)} placeholder="如：您的注册验证码" className="h-10 rounded-xl border-stone-200 bg-white" />
            </div>
            <div className="space-y-2">
              <label className="text-sm text-stone-700">
                邮件正文 <span className="text-rose-500">*</span>
              </label>
              <RichTextEditor value={formBodyHtml} onChange={setFormBodyHtml} />
              {variables.length > 0 ? (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-xs text-stone-400">插入变量：</span>
                  {variables.map((variable) => (
                    <button
                      key={variable}
                      type="button"
                      onClick={() => {
                        // 通过 execCommand 在光标处插入变量文本
                        const editor = document.querySelector('[contenteditable="true"]') as HTMLElement | null;
                        if (!editor) {
                          return;
                        }
                        editor.focus();
                        document.execCommand("insertText", false, `{{${variable}}}`);
                        const next = editor.innerHTML;
                        setFormBodyHtml(next);
                      }}
                      className="rounded-md border border-stone-200 bg-stone-50 px-2 py-1 font-mono text-[11px] text-stone-600 transition hover:border-stone-300 hover:bg-white"
                      title={`插入 {{${variable}}}`}
                    >
                      {`{{${variable}}}`}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            {preview ? (
              <div className="space-y-2 rounded-xl border border-stone-200 bg-stone-50 p-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold tracking-wider text-stone-500 uppercase">实时预览（示例变量）</span>
                  <button type="button" className="text-stone-400 transition hover:text-stone-700" onClick={() => setPreview(null)} title="关闭预览">
                    <X className="size-4" />
                  </button>
                </div>
                <div className="rounded-lg border border-stone-200 bg-white px-4 py-3 text-sm font-medium text-stone-800">
                  {preview.subject}
                </div>
                <div
                  className="rounded-lg border border-stone-200 bg-white px-4 py-3 text-sm leading-6 text-stone-700"
                  dangerouslySetInnerHTML={{ __html: preview.body_html }}
                />
              </div>
            ) : null}
          </div>
          <DialogFooter className="gap-2 pt-2">
            <Button type="button" variant="outline" className="rounded-xl border-stone-200 bg-white text-stone-700" onClick={() => setEditorOpen(false)}>
              取消
            </Button>
            <Button type="button" variant="outline" className="rounded-xl border-stone-200 bg-white text-stone-700" onClick={() => void handlePreview()} disabled={isPreviewing}>
              {isPreviewing ? <LoaderCircle className="size-4 animate-spin" /> : <Eye className="size-4" />}
              预览
            </Button>
            <Button type="button" className="rounded-xl bg-stone-950 px-5 text-white hover:bg-stone-800" onClick={() => void handleSave()} disabled={isSaving}>
              {isSaving ? <LoaderCircle className="size-4 animate-spin" /> : null}
              保存模板
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 删除确认 */}
      <Dialog open={deleting !== null} onOpenChange={(open) => { if (!open) setDeleting(null); }}>
        <DialogContent className="rounded-2xl p-6">
          <DialogHeader className="gap-2">
            <DialogTitle>删除邮件模板</DialogTitle>
            <DialogDescription className="text-sm leading-6">
              确定删除模板 <span className="font-medium text-stone-900">{deleting?.name}</span> 吗？删除后该场景邮件将恢复使用内置默认文案。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="pt-2">
            <Button type="button" variant="outline" className="rounded-xl border-stone-200 bg-white text-stone-700" onClick={() => setDeleting(null)}>
              取消
            </Button>
            <Button type="button" className="rounded-xl bg-rose-600 text-white hover:bg-rose-700" onClick={() => void handleDelete()} disabled={isDeleting}>
              {isDeleting ? <LoaderCircle className="size-4 animate-spin" /> : null}
              删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
