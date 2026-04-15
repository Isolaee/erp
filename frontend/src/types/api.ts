export type UserRole = 'ADMIN' | 'TEAM_LEAD' | 'MEMBER';
export type ListScope = 'ORGANIZATION' | 'TEAM' | 'PERSONAL';
export type ListVisibility = 'PRIVATE' | 'TEAM' | 'ORGANIZATION';
export type TaskStatus = 'OPEN' | 'IN_PROGRESS' | 'DONE' | 'CANCELLED';
export type TaskPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
export type TaskAssignmentStatus = 'PENDING_ACCEPTANCE' | 'ACCEPTED' | 'REJECTED';
export type InviteStatus = 'PENDING' | 'ACCEPTED' | 'EXPIRED' | 'REVOKED';

export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  avatarUrl?: string;
  createdAt: string;
  githubId?: string;
  hasGithubToken?: boolean;
}

export interface Team {
  id: string;
  name: string;
  description?: string;
  createdAt: string;
  hasGithubPat?: boolean;
  _count?: { members: number };
  members?: TeamMember[];
  repoFollows?: RepoFollow[];
}

export interface TeamMember {
  id: string;
  userId: string;
  teamId: string;
  role: UserRole;
  joinedAt: string;
  user?: Pick<User, 'id' | 'name' | 'email' | 'role' | 'avatarUrl'>;
}

export interface RepoFollow {
  id: string;
  teamId: string;
  owner: string;
  repo: string;
  addedAt: string;
  lastSyncAt?: string;
}

export interface Invite {
  id: string;
  token: string;
  email?: string;
  teamId?: string;
  senderId: string;
  role: UserRole;
  status: InviteStatus;
  expiresAt: string;
  createdAt: string;
  inviteUrl?: string;
  sender?: { name: string; email: string };
  team?: { name: string };
}

export interface TaskList {
  id: string;
  title: string;
  description?: string;
  scope: ListScope;
  visibility: ListVisibility;
  ownerId: string;
  teamId?: string;
  createdAt: string;
  updatedAt: string;
  ownerUser?: Pick<User, 'id' | 'name'>;
  team?: Pick<Team, 'id' | 'name'>;
  tasks?: Task[];
  _count?: { tasks: number };
}

export interface TaskAssignment {
  id: string;
  taskId: string;
  assigneeId: string;
  assignedById?: string;
  status: TaskAssignmentStatus;
  note?: string;
  responseNote?: string;
  createdAt: string;
  respondedAt?: string;
  assignee?: Pick<User, 'id' | 'name' | 'avatarUrl'>;
}

export interface Task {
  id: string;
  listId: string;
  parentId?: string;
  title: string;
  description?: string;
  status: TaskStatus;
  priority: TaskPriority;
  order: number;
  creatorId: string;
  dueDate?: string;
  createdAt: string;
  updatedAt: string;
  subtasks?: Task[];
  assignments?: TaskAssignment[];
  creator?: Pick<User, 'id' | 'name'>;
  list?: Pick<TaskList, 'id' | 'title' | 'scope'>;
  _count?: { subtasks: number };
}

export interface AiRefinement {
  id: string;
  taskId?: string;
  listId?: string;
  prompt: string;
  response: string;
  toolCalls: unknown[];
  createdById: string;
  createdAt: string;
  createdBy?: Pick<User, 'id' | 'name'>;
}

// Documentation types
export type DocVisibility = 'PRIVATE' | 'TEAM' | 'ORGANIZATION';

export interface DocSection {
  id: string;
  heading: string;
  level: number;
  order: number;
}

export interface Doc {
  id: string;
  title: string;
  content: string;
  visibility: DocVisibility;
  ownerId: string;
  teamId?: string;
  repoFollowId?: string;
  lastAutoSyncAt?: string;
  createdAt: string;
  updatedAt: string;
  owner?: Pick<User, 'id' | 'name'>;
  team?: Pick<Team, 'id' | 'name'>;
  repoFollow?: Pick<RepoFollow, 'id' | 'owner' | 'repo'>;
  sections?: DocSection[];
  aiRefinements?: AiRefinement[];
}

export interface DocSummary {
  id: string;
  title: string;
  visibility: DocVisibility;
  ownerId: string;
  teamId?: string;
  repoFollowId?: string;
  lastAutoSyncAt?: string;
  createdAt: string;
  updatedAt: string;
  owner?: Pick<User, 'id' | 'name'>;
  team?: Pick<Team, 'id' | 'name'>;
  repoFollow?: Pick<RepoFollow, 'id' | 'owner' | 'repo'>;
  rank?: number;
}

// GitHub types
export interface GithubRepo {
  id: number;
  fullName: string;
  description?: string;
  stars: number;
  forks: number;
  openIssues: number;
  url: string;
  defaultBranch: string;
}

export interface GithubIssue {
  number: number;
  title: string;
  state: string;
  url: string;
  author?: string;
  labels?: string[];
  createdAt: string;
}

export interface GithubPR {
  number: number;
  title: string;
  state: string;
  url: string;
  author?: string;
  draft?: boolean;
  createdAt: string;
}

export interface GithubCommit {
  sha: string;
  message: string;
  author?: string;
  date?: string;
  url: string;
}
