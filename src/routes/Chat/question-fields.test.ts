import type { ChatQuestionRequest } from "../../../electron/chat/common.ts"

import { describe, expect, it } from "vitest"
import {
  answersFromFieldDrafts,
  deriveQuestionFields,
  initialFieldDrafts,
  isQuestionDraftSnapshotPristine,
} from "./question-fields.ts"

describe("question-fields", () => {
  it("splits a combined Gmail draft question into typed form fields", () => {
    const request: ChatQuestionRequest = {
      id: "q1",
      sessionId: "s1",
      questions: [
        {
          header: "创建 Gmail 草稿",
          question:
            "创建 Gmail 草稿需要以下信息： 1. 收件人邮箱地址是什么？ 2. 邮件主题是什么？ 正文内容已确定为：「测试连接」",
          options: [{ label: "我来自定义", description: "我自己指定收件人和主题" }],
        },
      ],
    }

    const fields = deriveQuestionFields(request)

    expect(fields.map((field) => ({ label: field.label, kind: field.kind, value: field.value }))).toEqual([
      { label: "收件人", kind: "email", value: "" },
      { label: "主题", kind: "text", value: "" },
      { label: "正文", kind: "textarea", value: "测试连接" },
    ])
    expect(fields.every((field) => field.options.length === 0)).toBe(true)
  })

  it("serializes split fields back to the original question answer", () => {
    const request: ChatQuestionRequest = {
      id: "q1",
      sessionId: "s1",
      questions: [
        {
          header: "创建 Gmail 草稿",
          question: "1. 收件人邮箱地址是什么？ 2. 邮件主题是什么？ 正文内容已确定为：「测试连接」",
          options: [],
        },
      ],
    }
    const fields = deriveQuestionFields(request)
    const drafts = initialFieldDrafts(fields)
    drafts[0].value = "foo@example.com"
    drafts[1].value = "测试主题"

    expect(answersFromFieldDrafts(request, fields, drafts)).toEqual([
      ["收件人: foo@example.com\n主题: 测试主题\n正文: 测试连接"],
    ])
  })

  it("keeps numbered prompts authoritative when concrete options are also present", () => {
    const request: ChatQuestionRequest = {
      id: "q1",
      sessionId: "s1",
      questions: [
        {
          header: "创建 Gmail 草稿",
          question: "1. 收件人邮箱地址是什么？ 2. 邮件主题是什么？",
          options: [{ label: "测试连接", description: "主题使用「测试连接」" }],
        },
      ],
    }

    const fields = deriveQuestionFields(request)

    expect(fields.map((field) => ({ label: field.label, kind: field.kind, options: field.options }))).toEqual([
      { label: "收件人", kind: "email", options: [] },
      { label: "主题", kind: "text", options: [] },
    ])
  })

  it("turns field-like options into stable fields and removes duplicates", () => {
    const request: ChatQuestionRequest = {
      id: "q1",
      sessionId: "s1",
      questions: [
        {
          header: "草稿信息",
          question: "创建草稿需要收件人和邮件主题，请提供以下信息：",
          options: [
            { label: "填写收件人", description: "输入收件人的邮箱地址" },
            { label: "填写主题", description: "输入邮件主题" },
            { label: "填写收件人" },
          ],
        },
      ],
    }

    const fields = deriveQuestionFields(request)

    expect(fields.map((field) => ({ label: field.label, kind: field.kind, options: field.options.length }))).toEqual([
      { label: "收件人", kind: "email", options: 0 },
      { label: "主题", kind: "text", options: 0 },
    ])
  })

  it("keeps only concrete email choices for an email field", () => {
    const request: ChatQuestionRequest = {
      id: "q1",
      sessionId: "s1",
      questions: [
        {
          header: "收件人",
          question: "收件人邮箱地址是什么？",
          options: [
            { label: "我自己", description: "使用当前 Gmail 地址" },
            { label: "zhangli@oomol.com", description: "最近联系人" },
          ],
        },
      ],
    }

    const fields = deriveQuestionFields(request)

    expect(fields).toHaveLength(1)
    expect(fields[0].label).toBe("收件人")
    expect(fields[0].kind).toBe("email")
    expect(fields[0].options).toEqual([
      { label: "zhangli@oomol.com", description: "最近联系人", value: "zhangli@oomol.com" },
    ])
  })

  it("keeps concrete subject suggestions for a text field", () => {
    const request: ChatQuestionRequest = {
      id: "q1",
      sessionId: "s1",
      questions: [
        {
          header: "邮件主题",
          question: "草稿的主题是什么？",
          options: [
            { label: "测试连接", description: "主题使用「测试连接」" },
            { label: "输入其他主题", description: "我来手动输入主题内容" },
          ],
        },
      ],
    }

    const fields = deriveQuestionFields(request)

    expect(fields).toHaveLength(1)
    expect(fields[0].label).toBe("主题")
    expect(fields[0].kind).toBe("text")
    expect(fields[0].options).toEqual([
      { label: "测试连接", description: "主题使用「测试连接」", value: "测试连接" },
      { label: "输入其他主题", description: "我来手动输入主题内容", manual: true, value: "" },
    ])
  })

  it("uses a direct input when an email field only has a manual option", () => {
    const request: ChatQuestionRequest = {
      id: "q1",
      sessionId: "s1",
      questions: [
        {
          header: "收件人",
          question: "收件人邮箱地址是什么？",
          options: [{ label: "输入其他邮箱", description: "我来手动输入收件人邮箱地址" }],
        },
      ],
    }

    const fields = deriveQuestionFields(request)

    expect(fields).toHaveLength(1)
    expect(fields[0].label).toBe("收件人")
    expect(fields[0].kind).toBe("email")
    expect(fields[0].options).toEqual([])
  })

  it("treats only unchanged first-step drafts as pristine", () => {
    const initialDrafts = [{ selected: [], value: "" }]

    expect(
      isQuestionDraftSnapshotPristine({ activeFieldIndex: 0, drafts: [{ selected: [], value: "" }] }, initialDrafts),
    ).toBe(true)
    expect(
      isQuestionDraftSnapshotPristine({ activeFieldIndex: 1, drafts: [{ selected: [], value: "" }] }, initialDrafts),
    ).toBe(false)
    expect(
      isQuestionDraftSnapshotPristine({ activeFieldIndex: 0, drafts: [{ selected: [], value: " " }] }, initialDrafts),
    ).toBe(false)
    expect(
      isQuestionDraftSnapshotPristine({ activeFieldIndex: 0, drafts: [{ selected: ["A"], value: "" }] }, initialDrafts),
    ).toBe(false)
    expect(
      isQuestionDraftSnapshotPristine({ activeFieldIndex: 0, drafts: [{ selected: [], value: "" }] }, [
        { selected: [], value: "default" },
      ]),
    ).toBe(false)
  })
})
