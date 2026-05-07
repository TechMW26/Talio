function makeApproval({ project, legacyProjectHead, save = jest.fn().mockResolvedValue() }) {
    return {
        _id: 'approval-1',
        project,
        projectHead: legacyProjectHead,
        status: 'pending',
        save,
    }
}

function makeSelectQuery(result) {
    return {
        select: jest.fn().mockResolvedValue(result),
    }
}

describe('project completion approval permissions', () => {
    beforeEach(() => {
        jest.resetModules()
    })

    afterEach(() => {
        jest.restoreAllMocks()
    })

    test('allows a secondary project head from projectHeads to approve completion', async () => {
        const project = {
            _id: 'project-1',
            projectHead: 'legacy-head',
            projectHeads: ['legacy-head', 'secondary-head'],
            status: 'completed_pending_approval',
            save: jest.fn().mockResolvedValue(),
        }
        const approval = makeApproval({ project, legacyProjectHead: 'legacy-head' })

        const models = {
            ProjectCompletionApproval: {
                findById: jest.fn().mockReturnValue({
                    populate: jest.fn().mockResolvedValue(approval),
                }),
            },
            Project: {
                findById: jest.fn().mockResolvedValue(project),
            },
            ProjectMember: {
                findOne: jest.fn().mockReturnValue(makeSelectQuery(null)),
            },
            Task: {
                find: jest.fn(),
            },
            ProjectTimelineEvent: {
                create: jest.fn().mockResolvedValue({}),
            },
        }

        const { respondToCompletionApproval } = require('@/lib/projectService')
        const result = await respondToCompletionApproval(
            'approval-1',
            { _id: 'secondary-head' },
            true,
            'Looks good',
            false,
            models,
        )

        expect(result.project.status).toBe('completed')
        expect(approval.status).toBe('approved')
        expect(approval.respondedBy).toBe('secondary-head')
        expect(approval.save).toHaveBeenCalled()
        expect(project.save).toHaveBeenCalled()
    })

    test('allows an accepted head membership even when legacy projectHead differs', async () => {
        const project = {
            _id: 'project-1',
            projectHead: 'legacy-head',
            projectHeads: [],
            status: 'completed_pending_approval',
            save: jest.fn().mockResolvedValue(),
        }
        const approval = makeApproval({ project, legacyProjectHead: 'legacy-head' })

        const models = {
            ProjectCompletionApproval: {
                findById: jest.fn().mockReturnValue({
                    populate: jest.fn().mockResolvedValue(approval),
                }),
            },
            Project: {
                findById: jest.fn().mockResolvedValue(project),
            },
            ProjectMember: {
                findOne: jest.fn().mockReturnValue(makeSelectQuery({ _id: 'membership-1' })),
            },
            Task: {
                find: jest.fn(),
            },
            ProjectTimelineEvent: {
                create: jest.fn().mockResolvedValue({}),
            },
        }

        const { respondToCompletionApproval } = require('@/lib/projectService')
        const result = await respondToCompletionApproval(
            'approval-1',
            { _id: 'membership-head' },
            true,
            '',
            false,
            models,
        )

        expect(result.project.status).toBe('completed')
        expect(models.ProjectMember.findOne).toHaveBeenCalledWith({
            project: project._id,
            user: 'membership-head',
            role: 'head',
            invitationStatus: 'accepted',
        })
    })
})

describe('project completion approval API route', () => {
    beforeEach(() => {
        jest.resetModules()
    })

    afterEach(() => {
        jest.restoreAllMocks()
    })

    test('permits a secondary project head to respond through the PUT route', async () => {
        const respondToCompletionApproval = jest.fn().mockResolvedValue({
            approval: { _id: 'approval-1' },
            project: { _id: 'project-1' },
        })

        const models = {
            Project: {
                findById: jest.fn().mockResolvedValue({
                    _id: 'project-1',
                    projectHead: 'legacy-head',
                    projectHeads: ['legacy-head', 'secondary-head'],
                }),
            },
            ProjectMember: {
                findOne: jest.fn().mockReturnValue(makeSelectQuery(null)),
            },
            User: {
                findById: jest.fn().mockReturnValue(makeSelectQuery({
                    _id: 'user-1',
                    employeeId: 'secondary-head',
                    role: 'employee',
                })),
            },
            Employee: {
                findById: jest.fn().mockResolvedValue({
                    _id: 'secondary-head',
                    firstName: 'Secondary',
                    lastName: 'Head',
                }),
            },
        }

        jest.doMock('@/lib/auth', () => ({
            getAuthAndModels: jest.fn().mockResolvedValue({
                success: true,
                user: { _id: 'user-1', role: 'employee' },
                models,
            }),
        }))
        jest.doMock('@/lib/projectService', () => ({
            requestCompletionApproval: jest.fn(),
            respondToCompletionApproval,
            getProjectTaskStats: jest.fn(),
        }))
        jest.doMock('@/lib/projectNotifications', () => ({
            notifyProjectCompletionRequested: jest.fn(),
            notifyProjectApproved: jest.fn(),
            notifyProjectRejected: jest.fn(),
            getProjectMemberUserIds: jest.fn().mockResolvedValue([]),
        }))

        const { PUT } = require('@/app/api/projects/[projectId]/approval/route')
        const request = new Request('http://localhost/api/projects/project-1/approval', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                approvalId: 'approval-1',
                action: 'approve',
                remark: 'Approved',
            }),
        })

        const response = await PUT(request, { params: { projectId: 'project-1' } })
        const body = await response.json()

        expect(response.status).toBe(200)
        expect(body.success).toBe(true)
        expect(respondToCompletionApproval).toHaveBeenCalledWith(
            'approval-1',
            expect.objectContaining({ _id: 'secondary-head' }),
            true,
            'Approved',
            undefined,
            models,
            { isAdmin: false },
        )
    })
})
